import type { PrismaService } from "../database/prisma.service";
import {
  PublishFailedError,
  type ConfirmedPublisher,
} from "./rabbitmq-publisher-channel";
import type { ErpSalesTopology } from "./rabbitmq-topology";

export const OUTBOX_BATCH = 20;
/** The transaction spans the broker confirmation (10 s at most). */
const CLAIM_TIMEOUT_MS = 20_000;

export interface OutboxPublishSummary {
  published: number;
  failed: number;
  /** The broker was unreachable or refused: the rest waits for next run. */
  stopped: boolean;
}

export interface OutboxPublisherOptions {
  batch?: number;
  /** Test seam: runs after the broker confirmed and before marking published. */
  afterConfirm?: (eventId: string) => Promise<void>;
}

/**
 * Transactional outbox relay. Each event is claimed with FOR UPDATE SKIP
 * LOCKED (several API processes never publish the same row at once),
 * published with a broker confirm and marked published in the same
 * transaction, only after the confirm. A crash after the confirm leaves it
 * pending, so it is published again: delivery is at least once and the
 * consumer deduplicates by eventId.
 */
export class OutboxPublisher {
  private readonly batch: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: ConfirmedPublisher,
    private readonly topology: ErpSalesTopology,
    private readonly options: OutboxPublisherOptions = {},
  ) {
    this.batch = options.batch ?? OUTBOX_BATCH;
  }

  async publishPending(): Promise<OutboxPublishSummary> {
    const summary: OutboxPublishSummary = {
      published: 0,
      failed: 0,
      stopped: false,
    };
    for (let i = 0; i < this.batch; i += 1) {
      const outcome = await this.publishNext();
      if (outcome === "empty") break;
      if (outcome === "published") {
        summary.published += 1;
        continue;
      }
      summary.failed += 1;
      summary.stopped = true;
      break;
    }
    return summary;
  }

  private publishNext(): Promise<"empty" | "published" | "failed"> {
    return this.prisma.$transaction(
      async (tx) => {
        const [event] = await tx.$queryRaw<
          { id: string; type: string; payload: unknown }[]
        >`
          SELECT "id"::text AS "id", "type", "payload" FROM "OutboxEvent"
          WHERE "status" = 'pending'
          ORDER BY "createdAt", "id"
          LIMIT 1
          FOR UPDATE SKIP LOCKED`;
        if (!event) return "empty";
        try {
          await this.publisher.publish({
            exchange: this.topology.exchange,
            routingKey: event.type,
            body: Buffer.from(JSON.stringify(event.payload)),
            messageId: event.id,
            type: event.type,
            correlationId: correlationIdOf(event.payload),
          });
        } catch (error) {
          if (!(error instanceof PublishFailedError)) throw error;
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: { attempts: { increment: 1 } },
            select: { id: true },
          });
          console.error(
            `[API] Outbox event ${event.id} not published: ${error.message}`,
          );
          return "failed";
        }
        await this.options.afterConfirm?.(event.id);
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: { status: "published", publishedAt: new Date() },
          select: { id: true },
        });
        return "published";
      },
      { timeout: CLAIM_TIMEOUT_MS },
    );
  }
}

function correlationIdOf(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "correlationId" in payload) {
    const value = (payload as { correlationId: unknown }).correlationId;
    if (typeof value === "string") return value;
  }
  return undefined;
}
