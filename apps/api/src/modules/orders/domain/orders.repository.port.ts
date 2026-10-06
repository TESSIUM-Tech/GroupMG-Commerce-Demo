import type { CreateOrderCommand, OrderView } from "./order";

export interface NewPendingOrder {
  command: CreateOrderCommand;
  idempotencyKey: string;
  requestHash: string;
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
  reservationExpiresAt: Date;
  now: Date;
}

export type CreatePendingOrderResult =
  | { created: true; order: OrderView }
  | { created: false; order: OrderView; requestHash: string };

export interface ReleasedReservations {
  reservations: number;
  orders: number;
}

export interface OrdersRepository {
  /**
   * Prices from the database, reserves stock and persists the order atomically.
   * Returns the existing order when the idempotency key was already used.
   */
  createPendingOrder(input: NewPendingOrder): Promise<CreatePendingOrderResult>;
  replaceAccessToken(
    orderId: string,
    accessTokenHash: string,
    accessTokenExpiresAt: Date,
  ): Promise<void>;
  findByAccessToken(
    orderId: string,
    accessTokenHash: string,
    now: Date,
  ): Promise<OrderView | null>;
  /** Releases each expired active reservation exactly once. */
  releaseExpiredReservations(
    now: Date,
    limit: number,
  ): Promise<ReleasedReservations>;
}

export const ORDERS_REPOSITORY = Symbol("ORDERS_REPOSITORY");
