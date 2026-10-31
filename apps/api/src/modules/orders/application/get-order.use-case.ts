import type { OrderView } from "../domain/order";
import type { OrdersRepository } from "../domain/orders.repository.port";
import { hashAccessToken } from "./order-security";

export class GetOrderUseCase {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Returns null for unknown orders, wrong tokens and expired tokens alike. */
  execute(orderId: string, accessToken: string): Promise<OrderView | null> {
    return this.repository.findByAccessToken(
      orderId,
      hashAccessToken(accessToken),
      this.clock(),
    );
  }
}
