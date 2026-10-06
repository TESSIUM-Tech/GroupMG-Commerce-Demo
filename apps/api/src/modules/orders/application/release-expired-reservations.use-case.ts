import type {
  OrdersRepository,
  ReleasedReservations,
} from "../domain/orders.repository.port";

const BATCH_SIZE = 100;

export class ReleaseExpiredReservationsUseCase {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  execute(): Promise<ReleasedReservations> {
    return this.repository.releaseExpiredReservations(this.clock(), BATCH_SIZE);
  }
}
