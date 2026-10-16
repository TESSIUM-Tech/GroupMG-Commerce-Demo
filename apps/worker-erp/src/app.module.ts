import { Module } from "@nestjs/common";
import {
  WORKER_CONFIG,
  WorkerConfigError,
  loadWorkerConfig,
} from "./config/worker.config";
import { ErpSalesWorker } from "./messaging/erp-sales.worker";

@Module({
  providers: [
    {
      provide: WORKER_CONFIG,
      useFactory: () => {
        try {
          return loadWorkerConfig(process.env);
        } catch (error) {
          // Name the variable, never its value (URLs carry credentials).
          if (error instanceof WorkerConfigError) {
            console.error(`[worker] ${error.message}`);
          }
          throw error;
        }
      },
    },
    ErpSalesWorker,
  ],
})
export class AppModule {}
