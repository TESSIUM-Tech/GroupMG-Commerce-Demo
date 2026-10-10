import {
  assertTransition,
  type OrderStatus,
} from "../../orders/domain/order-status";

export interface ApprovedPaymentContext {
  orderStatus: OrderStatus;
  /** Every reservation of the order is still active and not past its expiry. */
  reservationsActive: boolean;
  /** Free stock (onHand - reserved) covers every item; read under row locks. */
  stockAvailable: boolean;
  /** This same payment was already approved for the order (a repeated notice). */
  alreadyApplied: boolean;
}

export type ApprovedPaymentReason =
  | "reserved_stock"
  | "late_payment_stock_available"
  | "late_payment_stock_unavailable"
  | "already_confirmed"
  | "order_already_paid"
  | "order_canceled"
  | "already_in_review";

export interface ApprovedPaymentDecision {
  /** New order status, or null to leave the order untouched. */
  orderStatus: OrderStatus | null;
  paymentStatus: "approved" | "review_required";
  /** How stock is taken when the order is confirmed. */
  stock: "consume_reservation" | "take_available" | "none";
  reason: ApprovedPaymentReason;
}

/**
 * What a verified, approved payment does to its order (docs/demo-rules.md).
 * A late payment confirms only if stock is still free; otherwise the order
 * goes to review_required. Confirmed stock never comes from nowhere.
 */
export function decideApprovedPayment(
  context: ApprovedPaymentContext,
): ApprovedPaymentDecision {
  const { orderStatus, reservationsActive, stockAvailable, alreadyApplied } =
    context;
  switch (orderStatus) {
    case "confirmed":
      // Same payment again: nothing to do. A different payment for an order
      // that is already paid is a double charge and must be refunded by hand.
      return alreadyApplied
        ? unchanged("approved", "already_confirmed")
        : unchanged("review_required", "order_already_paid");
    case "canceled":
      // Money arrived for an order that can no longer be fulfilled.
      return unchanged("review_required", "order_canceled");
    case "review_required":
      return unchanged("review_required", "already_in_review");
    case "pending_payment":
      if (reservationsActive) {
        return change(orderStatus, {
          orderStatus: "confirmed",
          paymentStatus: "approved",
          stock: "consume_reservation",
          reason: "reserved_stock",
        });
      }
      return latePayment(orderStatus, stockAvailable);
    case "expired":
      return latePayment(orderStatus, stockAvailable);
  }
}

function latePayment(
  from: OrderStatus,
  stockAvailable: boolean,
): ApprovedPaymentDecision {
  return stockAvailable
    ? change(from, {
        orderStatus: "confirmed",
        paymentStatus: "approved",
        stock: "take_available",
        reason: "late_payment_stock_available",
      })
    : change(from, {
        orderStatus: "review_required",
        paymentStatus: "review_required",
        stock: "none",
        reason: "late_payment_stock_unavailable",
      });
}

function change(
  from: OrderStatus,
  decision: ApprovedPaymentDecision & { orderStatus: OrderStatus },
): ApprovedPaymentDecision {
  assertTransition(from, decision.orderStatus);
  return decision;
}

function unchanged(
  paymentStatus: ApprovedPaymentDecision["paymentStatus"],
  reason: ApprovedPaymentReason,
): ApprovedPaymentDecision {
  return { orderStatus: null, paymentStatus, stock: "none", reason };
}
