import { Module } from "@nestjs/common";
import { ORDERS_REPOSITORY } from "./domain/orders.repository.port";
import type { OrdersRepository } from "./domain/orders.repository.port";
import { PrismaOrdersRepository } from "./infrastructure/prisma-orders.repository";
import { ReservationExpiryScheduler } from "./infrastructure/reservation-expiry.scheduler";
import { CreateOrderUseCase } from "./application/create-order.use-case";
import { GetOrderUseCase } from "./application/get-order.use-case";
import { ReleaseExpiredReservationsUseCase } from "./application/release-expired-reservations.use-case";
import { OrdersController } from "./presentation/orders.controller";

@Module({
  controllers: [OrdersController],
  providers: [
    PrismaOrdersRepository,
    {
      provide: ORDERS_REPOSITORY,
      useExisting: PrismaOrdersRepository,
    },
    {
      provide: CreateOrderUseCase,
      useFactory: (repository: OrdersRepository) =>
        new CreateOrderUseCase(repository),
      inject: [ORDERS_REPOSITORY],
    },
    {
      provide: GetOrderUseCase,
      useFactory: (repository: OrdersRepository) =>
        new GetOrderUseCase(repository),
      inject: [ORDERS_REPOSITORY],
    },
    {
      provide: ReleaseExpiredReservationsUseCase,
      useFactory: (repository: OrdersRepository) =>
        new ReleaseExpiredReservationsUseCase(repository),
      inject: [ORDERS_REPOSITORY],
    },
    ReservationExpiryScheduler,
  ],
  exports: [ORDERS_REPOSITORY],
})
export class OrdersModule {}
