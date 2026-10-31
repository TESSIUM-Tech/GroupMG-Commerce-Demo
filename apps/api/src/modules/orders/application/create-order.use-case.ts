import type { CreateOrderCommand, OrderView } from "../domain/order";
import { IdempotencyKeyReusedError } from "../domain/order-errors";
import type { OrdersRepository } from "../domain/orders.repository.port";
import {
  ACCESS_TOKEN_TTL_MS,
  RESERVATION_TTL_MS,
  generateAccessToken,
  hashRequest,
} from "./order-security";

export interface CreateOrderResult {
  order: OrderView;
  accessToken: string;
  replayed: boolean;
}

export class CreateOrderUseCase {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    idempotencyKey: string,
    command: CreateOrderCommand,
  ): Promise<CreateOrderResult> {
    const now = this.clock();
    const requestHash = hashRequest(command);
    const token = generateAccessToken();
    const accessTokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
    const result = await this.repository.createPendingOrder({
      command,
      idempotencyKey,
      requestHash,
      accessTokenHash: token.hash,
      accessTokenExpiresAt,
      reservationExpiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
      now,
    });
    if (result.created) {
      return { order: result.order, accessToken: token.token, replayed: false };
    }
    if (result.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError();
    }
    // Only the hash is stored, so a replay (e.g. a lost response) gets a fresh
    // token and the previous one stops working.
    await this.repository.replaceAccessToken(
      result.order.id,
      token.hash,
      accessTokenExpiresAt,
    );
    return { order: result.order, accessToken: token.token, replayed: true };
  }
}
