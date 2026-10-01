import { DatabaseModule } from "./database/database.module";
import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { AuthModule } from "./modules/auth/auth.module";
import { PaymentsModule } from "./modules/payments/payments.module";

@Module({
  imports: [
    DatabaseModule,
    CatalogModule,
    OrdersModule,
    AuthModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
