import { InvalidOrderTransitionError } from "./order-errors";

export const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "canceled",
  "expired",
  "review_required",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed transitions (docs/demo-rules.md). confirmed and canceled are final.
 * expired only moves on when a verified payment arrives late: confirmed if the
 * stock is still available, otherwise review_required (never confirm missing stock).
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["confirmed", "canceled", "expired", "review_required"],
  expired: ["confirmed", "review_required"],
  review_required: ["confirmed", "canceled"],
  confirmed: [],
  canceled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidOrderTransitionError(from, to);
}
