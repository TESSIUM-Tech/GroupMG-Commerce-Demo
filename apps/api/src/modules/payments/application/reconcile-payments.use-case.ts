import { createHash, randomUUID } from "node:crypto";
import { ProviderSaleMismatchError } from "../domain/payment-errors";
import {
  PaymentProviderRejectedError,
  PaymentProviderUnavailableError,
  type PaymentProvider,
} from "../domain/payment-provider.port";
import type {
  PaymentsRepository,
  StoredPayment,
} from "../domain/payments.repository.port";
import type { HandlePayPhoneCallbackUseCase } from "./handle-callback.use-case";

/** Give the regular callback a chance before polling PayPhone. */
export const RECONCILE_AFTER_MS = 60_000;
/** A sale PayPhone never heard of after this long was never created. */
export const ABANDON_UNKNOWN_SALE_AFTER_MS = 10 * 60_000;
/** Status queries per run; leaves room for callbacks within 30/minute. */
export const RECONCILE_BATCH = 10;

export interface ReconciliationSummary {
  checked: number;
  settled: number;
  stillPending: number;
  abandoned: number;
  flagged: number;
  /** PayPhone unavailable or budget exhausted: the rest waits for next run. */
  stopped: boolean;
}

/**
 * Resolves payments whose callback never arrived or whose creation timed out
 * (docs/demo-rules.md: a timeout is not a rejection; reconcile). Settlement is
 * the same verified, deduplicated path as the callback.
 */
export class ReconcilePaymentsUseCase {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly provider: PaymentProvider | null,
    private readonly callback: HandlePayPhoneCallbackUseCase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      checked: 0,
      settled: 0,
      stillPending: 0,
      abandoned: 0,
      flagged: 0,
      stopped: false,
    };
    if (!this.provider) return summary;
    const now = this.clock();
    const pending = await this.repository.findPendingPayments(
      new Date(now.getTime() - RECONCILE_AFTER_MS),
      RECONCILE_BATCH,
    );
    for (const payment of pending) {
      summary.checked += 1;
      try {
        const outcome = await this.reconcile(payment, now);
        if (outcome === "settled") summary.settled += 1;
        else if (outcome === "abandoned") summary.abandoned += 1;
        else summary.stillPending += 1;
      } catch (error) {
        if (error instanceof PaymentProviderUnavailableError) {
          summary.stopped = true;
          break;
        }
        if (
          error instanceof ProviderSaleMismatchError ||
          error instanceof PaymentProviderRejectedError
        ) {
          // Never settle data we cannot trust, and never retry it forever.
          await this.repository.flagPendingForReview(payment.id);
          summary.flagged += 1;
          continue;
        }
        throw error;
      }
    }
    return summary;
  }

  private async reconcile(
    payment: StoredPayment & { createdAt: Date },
    now: Date,
  ): Promise<"settled" | "pending" | "abandoned"> {
    let transactionId = payment.providerTransactionId;
    if (!transactionId) {
      // Creation timed out: look the sale up before anything else.
      const sale = await this.provider!.findSaleByClientTransactionId(
        payment.clientTransactionId,
      );
      if (!sale) {
        const age = now.getTime() - payment.createdAt.getTime();
        if (age < ABANDON_UNKNOWN_SALE_AFTER_MS) return "pending";
        await this.repository.cancelPendingPayment(payment.id);
        return "abandoned";
      }
      transactionId = sale.transactionId;
      await this.repository.recordProviderTransaction(
        payment.id,
        transactionId,
      );
    }
    const payloadHash = createHash("sha256")
      .update(`reconciliation ${transactionId} ${now.toISOString()}`)
      .digest("hex");
    const outcome = await this.callback.settleFromProvider(
      { ...payment, providerTransactionId: transactionId },
      transactionId,
      payloadHash,
      `reconcile-${randomUUID()}`,
    );
    return outcome.kind === "pending" ? "pending" : "settled";
  }
}
