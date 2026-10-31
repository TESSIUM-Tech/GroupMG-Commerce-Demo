import {
  assertTransition,
  type OrderStatus,
} from "../../orders/domain/order-status";
import type { PaymentStatus } from "./payments.repository.port";

export interface FailedPaymentContext {
  outcome: "canceled" | "rejected";
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  /** Another attempt for the same order is still pending at the provider. */
  otherPendingPayments: boolean;
}

export type FailedPaymentReason =
  | "order_canceled"
  | "other_attempt_pending"
  | "order_not_pending"
  | "after_approval_ignored"
  | "already_final";

export interface FailedPaymentDecision {
  /** New payment status, or null to leave it untouched. */
  paymentStatus: "canceled" | "rejected" | null;
  orderStatus: OrderStatus | null;
  /** Release the order's active reservations exactly once. */
  releaseReservations: boolean;
  reason: FailedPaymentReason;
}

/**
 * A canceled (PayPhone statusCode 2) or simulated-rejected payment: the
 * reservation is released once and the order canceled, unless the payment was
 * already settled or another attempt can still pay the order. A cancellation
 * arriving after an approval is out of order and ignored: never un-confirm.
 */
export function decideFailedPayment(
  context: FailedPaymentContext,
): FailedPaymentDecision {
  const { outcome, paymentStatus, orderStatus, otherPendingPayments } = context;
  if (paymentStatus === "approved") {
    return none("after_approval_ignored");
  }
  if (paymentStatus !== "pending") return none("already_final");
  if (orderStatus !== "pending_payment") {
    return {
      paymentStatus: outcome,
      orderStatus: null,
      releaseReservations: false,
      reason: "order_not_pending",
    };
  }
  if (otherPendingPayments) {
    return {
      paymentStatus: outcome,
      orderStatus: null,
      releaseReservations: false,
      reason: "other_attempt_pending",
    };
  }
  assertTransition(orderStatus, "canceled");
  return {
    paymentStatus: outcome,
    orderStatus: "canceled",
    releaseReservations: true,
    reason: "order_canceled",
  };
}

function none(reason: FailedPaymentReason): FailedPaymentDecision {
  return {
    paymentStatus: null,
    orderStatus: null,
    releaseReservations: false,
    reason,
  };
}
