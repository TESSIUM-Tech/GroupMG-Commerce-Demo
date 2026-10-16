import type { ConfirmChannel, GetMessage } from "amqplib";
import type { ErpSalesTopology } from "./rabbitmq-topology";

export interface DeadLetterSummary {
  eventId: string | null;
  correlationId: string | null;
  reason: string | null;
  deadLetteredAt: string | null;
  deliveryCount: number | null;
  reprocessCount: number;
}

export interface DlqHistoryEntry {
  reason: string | null;
  at: string | null;
  deliveryCount: number | null;
}

function header(message: GetMessage, name: string): unknown {
  return message.properties.headers?.[name];
}

function summarize(message: GetMessage): DeadLetterSummary {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const history = header(message, "x-dlq-history");
  return {
    eventId: text(message.properties.messageId),
    correlationId: text(message.properties.correlationId),
    reason: text(header(message, "x-dlq-reason")),
    deadLetteredAt: text(header(message, "x-dlq-at")),
    deliveryCount:
      typeof header(message, "x-dlq-delivery-count") === "number"
        ? (header(message, "x-dlq-delivery-count") as number)
        : null,
    reprocessCount: Array.isArray(history) ? history.length : 0,
  };
}

/**
 * Takes every DLQ message without acking it. Closing the channel afterwards
 * returns them all to the DLQ untouched, so listing never loses anything.
 */
async function takeAll(
  channel: ConfirmChannel,
  queue: string,
): Promise<GetMessage[]> {
  const taken: GetMessage[] = [];
  for (;;) {
    const message = await channel.get(queue, { noAck: false });
    if (!message) return taken;
    taken.push(message);
  }
}

/** Read-only view of the DLQ; the caller closes the channel to release them. */
export async function listDeadLetters(
  channel: ConfirmChannel,
  topology: ErpSalesTopology,
): Promise<DeadLetterSummary[]> {
  const messages = await takeAll(channel, topology.deadLetterQueue);
  return messages.map(summarize);
}

/**
 * Sends dead-lettered sales back to the sales queue for a fresh round of
 * attempts. Same body, messageId (eventId) and correlationId, so consumer
 * deduplication still applies; x-death is dropped (new attempt budget) and
 * the DLQ visit is appended to x-dlq-history. The DLQ copy is acked only
 * after the broker confirms the new one. Messages not selected are released.
 */
export async function reprocessDeadLetters(
  channel: ConfirmChannel,
  topology: ErpSalesTopology,
  select: (summary: DeadLetterSummary) => boolean,
): Promise<DeadLetterSummary[]> {
  const messages = await takeAll(channel, topology.deadLetterQueue);
  const reprocessed: DeadLetterSummary[] = [];
  for (const message of messages) {
    const summary = summarize(message);
    if (!select(summary)) {
      channel.nack(message, false, true);
      continue;
    }
    const {
      "x-death": _death,
      "x-dlq-reason": _reason,
      "x-dlq-at": _at,
      "x-dlq-delivery-count": _count,
      "x-dlq-history": previous,
      ...headers
    } = message.properties.headers ?? {};
    const history: DlqHistoryEntry[] = [
      ...(Array.isArray(previous) ? (previous as DlqHistoryEntry[]) : []),
      {
        reason: summary.reason,
        at: summary.deadLetteredAt,
        deliveryCount: summary.deliveryCount,
      },
    ];
    await new Promise<void>((done, fail) =>
      channel.sendToQueue(
        topology.queue,
        message.content,
        {
          persistent: true,
          messageId: message.properties.messageId,
          type: message.properties.type,
          contentType: message.properties.contentType,
          correlationId: message.properties.correlationId,
          timestamp: message.properties.timestamp,
          appId: message.properties.appId,
          headers: {
            ...headers,
            "x-dlq-history": history,
            "x-reprocessed-at": new Date().toISOString(),
          },
        },
        (error) => (error ? fail(error) : done()),
      ),
    );
    channel.ack(message);
    reprocessed.push({ ...summary, reprocessCount: history.length });
  }
  return reprocessed;
}
