import {
  InvalidCallbackSignatureError,
  PaymentNotFoundError,
  PaymentsDisabledError,
  ProviderSaleMismatchError,
} from "../domain/payment-errors";
import type { PaymentProvider } from "../domain/payment-provider.port";
import type {
  PaymentsRepository,
  SettlementResult,
  StoredPayment,
} from "../domain/payments.repository.port";
import type { PaymentsConfig } from "../infrastructure/payments.config";
import { verifyCallbackSignature } from "./callback-signature";

export interface PayPhoneCallback {
  signature: string;
  /** PayPhone's "id" parameter: its transactionId. */
  transactionId: string;
  /** PayPhone's "clientTransactionID" parameter. */
  clientTransactionId: string;
  payloadHash: string;
  correlationId: string;
}

export type VerifiedOutcome = { kind: "pending" } | SettlementResult;

/**
 * The notification is only a trigger (docs/demo-rules.md): after checking our
 * HMAC we ask PayPhone for the sale and act only on what PayPhone reports,
 * matched against the stored payment (ids, amount and currency).
 */
export class HandlePayPhoneCallbackUseCase {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly provider: PaymentProvider | null,
    private readonly config: PaymentsConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(callback: PayPhoneCallback): Promise<VerifiedOutcome> {
    if (!this.provider || !this.config.callbackSecret) {
      throw new PaymentsDisabledError();
    }
    if (
      !verifyCallbackSignature(
        this.config.callbackSecret,
        callback.clientTransactionId,
        callback.signature,
      )
    ) {
      throw new InvalidCallbackSignatureError();
    }
    const payment = await this.repository.findPaymentByClientTransactionId(
      callback.clientTransactionId,
    );
    if (!payment) throw new PaymentNotFoundError();
    return this.settleFromProvider(
      payment,
      callback.transactionId,
      callback.payloadHash,
      callback.correlationId,
    );
  }

  /** Shared with reconciliation: verify with PayPhone, then settle once. */
  async settleFromProvider(
    payment: StoredPayment,
    transactionId: string,
    payloadHash: string,
    correlationId: string,
  ): Promise<VerifiedOutcome> {
    if (!this.provider) throw new PaymentsDisabledError();
    if (
      payment.providerTransactionId &&
      payment.providerTransactionId !== transactionId
    ) {
      throw new ProviderSaleMismatchError("transactionId");
    }
    const sale = await this.provider.getSale(transactionId);
    if (sale.transactionId !== transactionId) {
      throw new ProviderSaleMismatchError("transactionId");
    }
    if (sale.clientTransactionId !== payment.clientTransactionId) {
      throw new ProviderSaleMismatchError("clientTransactionId");
    }
    if (sale.amountMinor !== payment.amountMinor) {
      throw new ProviderSaleMismatchError("amount");
    }
    if (sale.currency !== payment.currency) {
      throw new ProviderSaleMismatchError("currency");
    }
    if (sale.status === "pending") return { kind: "pending" };
    return this.repository.settle({
      paymentId: payment.id,
      providerTransactionId: sale.transactionId,
      providerStatus: sale.status,
      eventKey: `${sale.transactionId}:${sale.status}`,
      payloadHash,
      correlationId,
      now: this.clock(),
    });
  }
}
