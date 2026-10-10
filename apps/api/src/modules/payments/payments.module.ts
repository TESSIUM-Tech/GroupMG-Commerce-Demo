import { Module } from "@nestjs/common";
import {
  PAYMENTS_CONFIG,
  PaymentsConfigError,
  loadPaymentsConfig,
} from "./infrastructure/payments.config";

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
  ],
  exports: [PAYMENTS_CONFIG],
})
export class PaymentsModule {}
