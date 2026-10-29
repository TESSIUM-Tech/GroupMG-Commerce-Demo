import { Module } from "@nestjs/common";
import {
  WORKER_CONFIG,
  WorkerConfigError,
  loadWorkerConfig,
  type WorkerConfig,
} from "./config/worker.config";
import { ErpSalesWorker } from "./messaging/erp-sales.worker";
import { InventorySyncWorker } from "./sync/inventory-sync.worker";
import { ERP_PORT } from "./ports/erp.port";
import { SimulatedErpAdapter } from "./adapters/simulated-erp/simulated-erp.adapter";

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
    {
      // ERP adapter selection (docs/erp-simulator.md). null with ERP_ADAPTER=none.
      provide: ERP_PORT,
      useFactory: (config: WorkerConfig) =>
        config.erpAdapter === "simulated"
          ? new SimulatedErpAdapter({
              baseUrl: config.erpBaseUrl,
              timeoutMs: config.erpTimeoutMs,
              pageSize: config.erpPageSize,
            })
          : null,
      inject: [WORKER_CONFIG],
    },
    ErpSalesWorker,
    InventorySyncWorker,
  ],
  exports: [ERP_PORT],
})
export class AppModule {}
