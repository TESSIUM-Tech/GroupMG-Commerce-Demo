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
}

export const PAYMENTS_REPOSITORY = Symbol("PAYMENTS_REPOSITORY");
