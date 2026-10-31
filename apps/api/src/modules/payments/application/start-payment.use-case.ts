import { randomUUID } from "node:crypto";
import { hashAccessToken } from "../../orders/application/order-security";
import {
  OrderNotPayableError,
  PayableOrderNotFoundError,
  PaymentRefusedByProviderError,
  PaymentsDisabledError,
  ReservationExpiredError,
  InvalidPayPhoneNumberError,
} from "../domain/payment-errors";
import {
  PaymentProviderRejectedError,
  PaymentProviderUnavailableError,
  type PaymentProvider,
} from "../domain/payment-provider.port";
import type {
  PaymentView,
  PaymentsRepository,
} from "../domain/payments.repository.port";
import { toPayPhoneNumber } from "../domain/payphone-phone";
import { buildSaleAmounts } from "../domain/sale-amounts";
import type { PaymentsConfig } from "../infrastructure/payments.config";
import { buildResponseUrl } from "./callback-signature";

/**
 * PayPhone keeps a sale payable for 5 minutes; the reservation is extended to
 * cover that window plus a margin, so stock is never released while the
 * customer can still approve (improvement A).
 */
export const PAYMENT_WINDOW_MS = 5 * 60_000 + 30_000;

/** Simulated mode never receives real callbacks; any base URL will do. */
const SIMULATED_CALLBACK_BASE = "http://localhost";

export interface StartPaymentResult {
  payment: PaymentView;
  /** created: new sale sent; existing: a pending payment was reused;
   *  unconfirmed: PayPhone did not answer, reconciliation will resolve it. */
  outcome: "created" | "existing" | "unconfirmed";
  reservationExpiresAt: Date;
}

export class StartPaymentUseCase {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly provider: PaymentProvider | null,
    private readonly config: PaymentsConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    orderId: string,
    accessToken: string,
    phoneOverride?: string,
  ): Promise<StartPaymentResult> {
    if (!this.provider || !this.config.callbackSecret) {
      throw new PaymentsDisabledError();
    }
    const now = this.clock();
    const order = await this.repository.findPayableOrder(
      orderId,
      hashAccessToken(accessToken),
      now,
    );
    if (!order) throw new PayableOrderNotFoundError();
    if (order.status !== "pending_payment") {
      throw new OrderNotPayableError(order.status);
    }
    // Improvement B: an expired reservation cannot be paid, even if the
    // periodic sweep has not released it yet.
    if (order.reservationExpiresAt <= now) throw new ReservationExpiredError();

    const phone = toPayPhoneNumber(phoneOverride ?? order.customerPhone);
    if (!phone) throw new InvalidPayPhoneNumberError();
    const amounts = buildSaleAmounts(order);

    const clientTransactionId = randomUUID();
    const prepared = await this.repository.preparePayment({
      orderId: order.id,
      clientTransactionId,
      amountMinor: amounts.amountMinor,
      reservationUntil: new Date(now.getTime() + PAYMENT_WINDOW_MS),
      now,
    });
    if (prepared.kind === "not_payable") {
      throw new OrderNotPayableError(prepared.status);
    }
    if (prepared.kind === "reservation_expired") {
      throw new ReservationExpiredError();
    }
    const { reservationExpiresAt } = prepared;
    if (prepared.kind === "existing") {
      // Never open a second sale while one is pending: no double charge.
      return {
        payment: prepared.payment,
        outcome: "existing",
        reservationExpiresAt,
      };
    }

    const payment = prepared.payment;
    try {
      const { transactionId } = await this.provider.createSale({
        clientTransactionId,
        ...phone,
        ...amounts,
        currency: order.currency,
        reference: `Pedido GroupMG ${order.id.slice(0, 8)}`,
        responseUrl: buildResponseUrl(
          this.config.responseBaseUrl ?? SIMULATED_CALLBACK_BASE,
          this.config.callbackSecret,
          clientTransactionId,
        ),
      });
      await this.repository.recordProviderTransaction(
        payment.id,
        transactionId,
      );
      return { payment, outcome: "created", reservationExpiresAt };
    } catch (error) {
      if (error instanceof PaymentProviderRejectedError) {
        // The sale was never created: free the attempt so the guest can retry.
        await this.repository.cancelPendingPayment(payment.id);
        throw new PaymentRefusedByProviderError(error.message);
      }
      if (error instanceof PaymentProviderUnavailableError) {
        // A timeout is not a rejection (docs/demo-rules.md): keep it pending and
        // let reconciliation look it up by clientTransactionId.
        return { payment, outcome: "unconfirmed", reservationExpiresAt };
      }
      throw error;
    }
  }
}
