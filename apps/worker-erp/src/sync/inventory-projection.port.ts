export interface ReconcileInventoryItemInput {
  sku: string;
  erpAvailable: number;
  erpUpdatedAt: Date;
}

export type ReconcileItemResult =
  | {
      status: "updated";
      sku: string;
      previousOnHand: number;
      newOnHand: number;
      reserved: number;
      effectiveAvailable: number;
    }
  | {
      status: "stale_snapshot_rejected";
      sku: string;
      erpUpdatedAt: Date;
      syncedAt: Date;
    }
  | {
      status: "product_not_found";
      sku: string;
    };

export interface InventorySyncCheckpoint {
  id: string;
  cursor: string | null;
  pageIndex: number;
  itemsSynced: number;
  status: "idle" | "in_progress" | "failed";
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface SaveCheckpointInput {
  id?: string;
  cursor: string | null;
  pageIndex: number;
  itemsSynced: number;
  status: "idle" | "in_progress" | "failed";
  lastError?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * Contrato interno protegido para la proyección de inventario (DEMO-13).
 * Actualiza la proyección Inventory sin escribir tablas privadas de pedidos ni pagos.
 */
export interface InventoryProjectionRepository {
  ensureSchema(): Promise<void>;
  getCheckpoint(id?: string): Promise<InventorySyncCheckpoint | null>;
  saveCheckpoint(input: SaveCheckpointInput): Promise<void>;
  reconcileItem(
    input: ReconcileInventoryItemInput,
    now?: Date,
  ): Promise<ReconcileItemResult>;
}
