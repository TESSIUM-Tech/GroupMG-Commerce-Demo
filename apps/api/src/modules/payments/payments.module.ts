import { Module } from "@nestjs/common";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from "./domain/payment-provider.port";
import {
  PAYMENTS_CONFIG,
  PaymentsConfigError,
  loadPaymentsConfig,
  type PaymentsConfig,
} from "./infrastructure/payments.config";
import { PayPhoneProvider } from "./infrastructure/payphone.provider";
import { SimulatedPaymentProvider } from "./infrastructure/simulated.provider";
import {
  PAYMENTS_REPOSITORY,
  type PaymentsRepository,
} from "./domain/payments.repository.port";
import { PrismaPaymentsRepository } from "./infrastructure/prisma-payments.repository";
import { StartPaymentUseCase } from "./application/start-payment.use-case";
import { PaymentsController } from "./presentation/payments.controller";

@Module({
  controllers: [PaymentsController],
  providers: [
    PrismaPaymentsRepository,
    { provide: PAYMENTS_REPOSITORY, useExisting: PrismaPaymentsRepository },
    {
      provide: StartPaymentUseCase,
      useFactory: (
        repository: PaymentsRepository,
        provider: PaymentProvider | null,
        config: PaymentsConfig,
      ) => new StartPaymentUseCase(repository, provider, config),
      inject: [PAYMENTS_REPOSITORY, PAYMENT_PROVIDER, PAYMENTS_CONFIG],
    },
    {
      provide: PAYMENTS_CONFIG,
      useFactory: () => {
        try {
          return loadPaymentsConfig(process.env);
        } catch (error) {
          // main.ts only prints a generic startup message; name the variables
          // here so the cause is visible. Values are never included.
          if (error instanceof PaymentsConfigError) {
            console.error(`[API] ${error.message}`);
          }
          throw error;
        }
      },
    },
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: PaymentsConfig): PaymentProvider | null => {
        if (config.mode === "payphone" && config.payphone) {
          return new PayPhoneProvider(config.payphone);
        }
        if (config.mode === "simulated") {
          return new SimulatedPaymentProvider(config.simulatedOutcome);
        }
        return null;
      },
      inject: [PAYMENTS_CONFIG],
    },
  ],
  exports: [PAYMENTS_CONFIG, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
