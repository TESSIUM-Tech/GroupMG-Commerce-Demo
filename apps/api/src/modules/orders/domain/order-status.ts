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
 * Allowed transitions (docs/demo-rules.md). confirmed, canceled and expired are final.
 * review_required covers a payment approved after its reservation was released.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["confirmed", "canceled", "expired", "review_required"],
  review_required: ["confirmed", "canceled"],
  confirmed: [],
  canceled: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidOrderTransitionError(from, to);
}
