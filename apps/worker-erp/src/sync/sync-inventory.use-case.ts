import type { ErpPort } from "../ports/erp.port";
import type { InventoryProjectionRepository } from "./inventory-projection.port";

export interface SyncInventoryResult {
  completed: boolean;
  pagesProcessed: number;
  itemsProcessed: number;
  itemsUpdated: number;
  staleRejected: number;
  productsNotFound: number;
  lastCursor: string | null;
  error?: string;
}

export interface SyncExecutionOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class SyncInventoryUseCase {
  constructor(
    private readonly repo: InventoryProjectionRepository,
    private readonly erp: ErpPort,
  ) {}

  async execute(options?: SyncExecutionOptions): Promise<SyncInventoryResult> {
    await this.repo.ensureSchema();

    const checkpoint = await this.repo.getCheckpoint();
    let cursor: string | undefined = undefined;
    let pageIndex = 0;
    let itemsSyncedSoFar = 0;

    // Resume from checkpoint if a previous execution was interrupted
    if (
      checkpoint &&
      checkpoint.status === "in_progress" &&
      checkpoint.cursor
    ) {
      cursor = checkpoint.cursor;
      pageIndex = checkpoint.pageIndex;
      itemsSyncedSoFar = checkpoint.itemsSynced;
    } else {
      await this.repo.saveCheckpoint({
        cursor: null,
        pageIndex: 0,
        itemsSynced: 0,
        status: "in_progress",
        startedAt: new Date(),
      });
    }

    let pagesProcessed = 0;
    let itemsProcessed = 0;
    let itemsUpdated = 0;
    let staleRejected = 0;
    let productsNotFound = 0;

    try {
      while (true) {
        if (options?.signal?.aborted) {
          throw new Error("Inventory sync aborted");
        }

        const page = await this.erp.getInventory(cursor);
        pagesProcessed++;

        for (const item of page.items) {
          const res = await this.repo.reconcileItem({
            sku: item.sku,
            erpAvailable: item.available,
            erpUpdatedAt: new Date(item.updatedAt),
          });
          itemsProcessed++;
          if (res.status === "updated") itemsUpdated++;
          else if (res.status === "stale_snapshot_rejected") staleRejected++;
          else if (res.status === "product_not_found") productsNotFound++;
        }

        itemsSyncedSoFar += page.items.length;
        pageIndex++;

        if (page.nextCursor) {
          cursor = page.nextCursor;
          await this.repo.saveCheckpoint({
            cursor,
            pageIndex,
            itemsSynced: itemsSyncedSoFar,
            status: "in_progress",
          });
        } else {
          // Finished all pages
          await this.repo.saveCheckpoint({
            cursor: null,
            pageIndex: 0,
            itemsSynced: itemsSyncedSoFar,
            status: "idle",
            completedAt: new Date(),
          });
          return {
            completed: true,
            pagesProcessed,
            itemsProcessed,
            itemsUpdated,
            staleRejected,
            productsNotFound,
            lastCursor: null,
          };
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.repo.saveCheckpoint({
        cursor: cursor ?? null,
        pageIndex,
        itemsSynced: itemsSyncedSoFar,
        status: "in_progress", // keep in_progress so next cycle resumes from cursor
        lastError: errorMessage,
      });
      throw error;
    }
  }
}
