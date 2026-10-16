import { validateOrderConfirmedV1 } from "../contracts/order-confirmed";
import type { OrderConfirmedV1 } from "../contracts/order-confirmed";
import { ErpRejectedError } from "../ports/erp-errors";
import type { ErpPort } from "../ports/erp.port";
import type { ErpSaleExportRepository } from "./erp-sale-export.repository";

export interface IncomingSale {
  body: Buffer;
  /** AMQP messageId; the publisher sets it to the eventId. */
  messageId?: string;
  /** 1 for the first delivery, increased by every retry round. */
  deliveryCount: number;
}

export type ExportDecision =
  | { action: "ack"; reason: "exported" | "duplicate" }
  | { action: "retry"; reason: string }
  | { action: "dead_letter"; reason: string };

/**
 * Exports one confirmed sale to the ERP, at most once per event.
 * The ERP is called with idempotencyKey = eventId, so a lost response is
 * resolved on the next delivery by the ERP returning the same sale. The
 * caller acks only after this resolves: every outcome is persisted first,
 * and any database error propagates so the message is never acked.
 */
export class ExportSaleUseCase {
  constructor(
    private readonly repository: ErpSaleExportRepository,
    private readonly erp: ErpPort,
    private readonly maxDeliveryAttempts: number,
  ) {}

  async execute(incoming: IncomingSale): Promise<ExportDecision> {
    let event: unknown;
    try {
      event = JSON.parse(incoming.body.toString("utf8"));
    } catch {
      return { action: "dead_letter", reason: "invalid_json" };
    }
    const problems = validateOrderConfirmedV1(event);
    if (problems.length > 0) {
      return {
        action: "dead_letter",
        reason: `invalid_event: ${problems.join("; ")}`,
      };
    }
    const sale = event as OrderConfirmedV1;
    if (incoming.messageId && incoming.messageId !== sale.eventId) {
      return {
        action: "dead_letter",
        reason: "messageId does not match eventId",
      };
    }

    const started = await this.repository.begin(
      sale.eventId,
      sale.data.orderId,
    );
    if (started.kind === "already_exported") {
      return { action: "ack", reason: "duplicate" };
    }
    if (started.kind === "order_already_exported") {
      return {
        action: "dead_letter",
        reason: `order already handled by event ${started.eventId}`,
      };
    }

    try {
      const { externalId } = await this.erp.postSale(
        {
          orderId: sale.data.orderId,
          currency: sale.data.currency,
          totalMinor: sale.data.totalMinor,
        },
        sale.eventId,
      );
      await this.repository.markExported(sale.eventId, externalId);
      return { action: "ack", reason: "exported" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "ERP error";
      if (error instanceof ErpRejectedError) {
        await this.repository.markFailed(sale.eventId, message);
        return { action: "dead_letter", reason: `erp_rejected: ${message}` };
      }
      if (incoming.deliveryCount >= this.maxDeliveryAttempts) {
        await this.repository.markFailed(sale.eventId, message);
        return {
          action: "dead_letter",
          reason: `erp_unavailable after ${incoming.deliveryCount} attempts: ${message}`,
        };
      }
      await this.repository.recordFailure(sale.eventId, message);
      return { action: "retry", reason: `erp_unavailable: ${message}` };
    }
  }
}
