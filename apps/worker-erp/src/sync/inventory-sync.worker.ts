import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { Pool } from "pg";
import { WORKER_CONFIG, type WorkerConfig } from "../config/worker.config";
import { ERP_PORT, type ErpPort } from "../ports/erp.port";
import { PgInventoryProjectionRepository } from "./inventory-projection.repository";
import { SyncInventoryUseCase } from "./sync-inventory.use-case";

@Injectable()
export class InventorySyncWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("InventorySyncWorker");
  private pool?: Pool;
  private timer?: NodeJS.Timeout;
  private initialTimer?: NodeJS.Timeout;
  private running = false;
  private useCase?: SyncInventoryUseCase;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(ERP_PORT) private readonly erp: ErpPort | null,
  ) {}

  onApplicationBootstrap(): void {
    const { erp, config } = this;
    const missing = [
      !config.databaseUrl && "DATABASE_URL",
      !erp && "ERP_ADAPTER",
    ].filter(Boolean);

    if (missing.length > 0 || !erp || !config.inventorySyncEnabled) {
      this.logger.log(
        `Inventory sync idle (${!config.inventorySyncEnabled ? "disabled by config" : `missing ${missing.join(", ")}`})`,
      );
      return;
    }

    this.pool = new Pool({
      connectionString: config.databaseUrl!,
      max: 4,
    });

    const repo = new PgInventoryProjectionRepository(this.pool);
    this.useCase = new SyncInventoryUseCase(repo, erp);

    // Initial sync shortly after boot
    this.initialTimer = setTimeout(() => void this.sync(), 1_000);
    this.initialTimer.unref();

    // Periodic sync without overlapping
    this.timer = setInterval(
      () => void this.sync(),
      config.inventorySyncIntervalMs,
    );
    this.timer.unref();

    this.logger.log(
      `Inventory sync scheduled every ${config.inventorySyncIntervalMs}ms (timeout: ${config.inventorySyncTimeoutMs}ms)`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    await this.pool?.end();
  }

  async sync(): Promise<void> {
    if (this.running || !this.useCase) return;
    this.running = true;

    try {
      const signal = AbortSignal.timeout(this.config.inventorySyncTimeoutMs);
      const res = await this.useCase.execute({
        timeoutMs: this.config.inventorySyncTimeoutMs,
        signal,
      });
      this.logger.log(
        `Inventory sync completed: ${res.pagesProcessed} page(s), ${res.itemsProcessed} item(s) processed (${res.itemsUpdated} updated, ${res.staleRejected} stale rejected, ${res.productsNotFound} not found)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Inventory sync run failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
