import type { OrderStatus } from "../../orders/domain/order-status";
import type { ChargeableOrder } from "./sale-amounts";

export type PaymentStatus =
  "pending" | "approved" | "canceled" | "rejected" | "review_required";

/** Public projection of a payment; no provider internals. */
export interface PaymentView {
  id: string;
  orderId: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  createdAt: Date;
}

/** Data needed to charge an order, read with its guest access token. */
export interface PayableOrder extends ChargeableOrder {
  id: string;
  status: OrderStatus;
  currency: string;
  reservationExpiresAt: Date;
  customerPhone: string;
}

export interface PreparePaymentInput {
  orderId: string;
  clientTransactionId: string;
  amountMinor: number;
  /** New reservation expiry so it covers PayPhone's payment window. */
  reservationUntil: Date;
  now: Date;
}

export type PreparePaymentResult =
  | { kind: "created"; payment: PaymentView; reservationExpiresAt: Date }
  | { kind: "existing"; payment: PaymentView; reservationExpiresAt: Date }
  | { kind: "not_payable"; status: OrderStatus }
  | { kind: "reservation_expired" };

export interface PaymentsRepository {
  /** null when the order does not exist or the token is wrong or expired. */
  findPayableOrder(
    orderId: string,
    accessTokenHash: string,
    now: Date,
  ): Promise<PayableOrder | null>;
  /**
   * In one transaction: re-checks the order under row locks, returns a pending
   * payment if one exists, otherwise extends the reservation and stores a new
   * pending payment.
   */
  preparePayment(input: PreparePaymentInput): Promise<PreparePaymentResult>;
  recordProviderTransaction(
    paymentId: string,
    providerTransactionId: string,
  ): Promise<void>;
  /** pending -> canceled when the provider refused to create the sale. */
  cancelPendingPayment(paymentId: string): Promise<void>;
  findPaymentByClientTransactionId(
    clientTransactionId: string,
  ): Promise<StoredPayment | null>;
  /**
   * Applies a provider-verified outcome in one transaction: stores the receipt
   * (deduplicated by eventKey), then updates payment, order, stock, reservations
   * and, when the order is confirmed, the order.confirmed.v1 outbox event.
   */
  settle(input: SettlementInput): Promise<SettlementResult>;
}

export interface StoredPayment {
  id: string;
  orderId: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  clientTransactionId: string;
  providerTransactionId: string | null;
}

/** Final outcomes only; pending sales are never settled. */
export type SettledProviderStatus = "approved" | "canceled" | "rejected";

export interface SettlementInput {
  paymentId: string;
  providerTransactionId: string;
  providerStatus: SettledProviderStatus;
  /** Provider event identity, e.g. "45441137:approved". */
  eventKey: string;
  /** SHA-256 of the original notification (method, URL and raw body). */
  payloadHash: string;
  correlationId: string;
  now: Date;
}

export type SettlementResult =
  | { kind: "duplicate" }
  | {
      kind: "settled";
      paymentStatus: PaymentStatus;
      orderStatus: OrderStatus;
      /** Why: policy reason for approvals, or the cancellation path taken. */
      reason: string;
      /** order.confirmed.v1 outbox eventId when the order was confirmed. */
      outboxEventId: string | null;
    };

export const PAYMENTS_REPOSITORY = Symbol("PAYMENTS_REPOSITORY");
