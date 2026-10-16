import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { Pool } from "pg";
import { WORKER_CONFIG, type WorkerConfig } from "../config/worker.config";
import { ErpSaleExportRepository } from "../exports/erp-sale-export.repository";
import { ExportSaleUseCase } from "../exports/export-sale.use-case";
import { createErpAdapter } from "../ports/erp-adapters";
import { ErpSalesConsumer } from "./erp-sales.consumer";
import { ERP_SALES_TOPOLOGY } from "./rabbitmq-topology";

/** Starts the sales consumer only when database, broker and ERP are configured. */
@Injectable()
export class ErpSalesWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("ErpSalesWorker");
  private pool?: Pool;
  private consumer?: ErpSalesConsumer;

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {}

  onApplicationBootstrap(): void {
    const erp = createErpAdapter(this.config.erpAdapter);
    const missing = [
      !this.config.databaseUrl && "DATABASE_URL",
      !this.config.rabbitmqUrl && "RABBITMQ_URL",
      !erp && "ERP_ADAPTER",
    ].filter(Boolean);
    if (missing.length > 0 || !erp) {
      this.logger.log(
        `Sales export idle (missing ${missing.join(", ")}); sales wait in ${ERP_SALES_TOPOLOGY.queue}`,
      );
      return;
    }
    this.pool = new Pool({
      connectionString: this.config.databaseUrl!,
      max: 4,
    });
    this.consumer = new ErpSalesConsumer(
      this.config.rabbitmqUrl!,
      ERP_SALES_TOPOLOGY,
      new ExportSaleUseCase(
        new ErpSaleExportRepository(this.pool),
        erp,
        ERP_SALES_TOPOLOGY.maxDeliveryAttempts,
      ),
      (line) => this.logger.log(line),
    );
    this.consumer.startWithRetry();
    this.logger.log(`Consuming ${ERP_SALES_TOPOLOGY.queue}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
    await this.pool?.end();
  }
}
