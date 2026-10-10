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

@Module({
  providers: [
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
