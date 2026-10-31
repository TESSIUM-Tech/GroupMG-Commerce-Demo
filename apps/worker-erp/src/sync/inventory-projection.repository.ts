import type { Pool, PoolClient } from "pg";
import type {
  InventoryProjectionRepository,
  InventorySyncCheckpoint,
  ReconcileInventoryItemInput,
  ReconcileItemResult,
  SaveCheckpointInput,
} from "./inventory-projection.port";

const DEFAULT_CHECKPOINT_ID = "inventory";

export class PgInventoryProjectionRepository implements InventoryProjectionRepository {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "ErpSyncCheckpoint" (
        "id" TEXT NOT NULL DEFAULT 'inventory',
        "cursor" TEXT,
        "pageIndex" INTEGER NOT NULL DEFAULT 0,
        "itemsSynced" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'idle',
        "lastError" TEXT,
        "startedAt" TIMESTAMPTZ(3),
        "completedAt" TIMESTAMPTZ(3),
        "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ErpSyncCheckpoint_pkey" PRIMARY KEY ("id")
      );
    `);
  }

  async getCheckpoint(
    id: string = DEFAULT_CHECKPOINT_ID,
  ): Promise<InventorySyncCheckpoint | null> {
    const { rows } = await this.pool.query<{
      id: string;
      cursor: string | null;
      pageIndex: number;
      itemsSynced: number;
      status: "idle" | "in_progress" | "failed";
      lastError: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
      updatedAt: Date;
    }>(
      `SELECT "id", "cursor", "pageIndex", "itemsSynced", "status", "lastError",
              "startedAt", "completedAt", "updatedAt"
       FROM "ErpSyncCheckpoint"
       WHERE "id" = $1`,
      [id],
    );
    if (!rows[0]) return null;
    return rows[0];
  }

  async saveCheckpoint(input: SaveCheckpointInput): Promise<void> {
    const id = input.id ?? DEFAULT_CHECKPOINT_ID;
    await this.pool.query(
      `INSERT INTO "ErpSyncCheckpoint" (
         "id", "cursor", "pageIndex", "itemsSynced", "status", "lastError",
         "startedAt", "completedAt", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT ("id") DO UPDATE
         SET "cursor" = EXCLUDED."cursor",
             "pageIndex" = EXCLUDED."pageIndex",
             "itemsSynced" = EXCLUDED."itemsSynced",
             "status" = EXCLUDED."status",
             "lastError" = EXCLUDED."lastError",
             "startedAt" = COALESCE(EXCLUDED."startedAt", "ErpSyncCheckpoint"."startedAt"),
             "completedAt" = EXCLUDED."completedAt",
             "updatedAt" = now()`,
      [
        id,
        input.cursor,
        input.pageIndex,
        input.itemsSynced,
        input.status,
        input.lastError?.slice(0, 500) ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
      ],
    );
  }

  async reconcileItem(
    input: ReconcileInventoryItemInput,
    now: Date = new Date(),
  ): Promise<ReconcileItemResult> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Lock the product row and read inventory snapshot
      const { rows: prodRows } = await client.query<{
        id: string;
        sku: string;
        onHand: number | null;
        reserved: number | null;
        sourceVersion: number | null;
        syncedAt: Date | null;
      }>(
        `SELECT p.id, p.sku, i."onHand", i."reserved", i."sourceVersion", i."syncedAt"
         FROM "Product" p
         LEFT JOIN "Inventory" i ON i."productId" = p.id
         WHERE p.sku = $1
         FOR UPDATE OF p`,
        [input.sku],
      );

      if (!prodRows[0]) {
        await client.query("ROLLBACK");
        return { status: "product_not_found", sku: input.sku };
      }

      const prod = prodRows[0];
      const previousOnHand = prod.onHand ?? 0;

      // 2. Reject stale snapshot: if erpUpdatedAt is older than already syncedAt
      if (prod.syncedAt && input.erpUpdatedAt < prod.syncedAt) {
        await client.query("ROLLBACK");
        return {
          status: "stale_snapshot_rejected",
          sku: input.sku,
          erpUpdatedAt: input.erpUpdatedAt,
          syncedAt: prod.syncedAt,
        };
      }

      // 3. Query active local reservations for this product
      const { rows: resRows } = await client.query<{ reservedQty: number }>(
        `SELECT COALESCE(SUM(quantity), 0)::integer AS "reservedQty"
         FROM "StockReservation"
         WHERE "productId" = $1
           AND "status" = 'active'
           AND "expiresAt" > $2`,
        [prod.id, now],
      );
      const reservedQty = resRows[0]?.reservedQty ?? 0;

      // 4. Query local confirmed sales not yet exported to ERP (or exported after the ERP snapshot)
      const { rows: unexpRows } = await client.query<{ unexportedQty: number }>(
        `SELECT COALESCE(SUM(oi.quantity), 0)::integer AS "unexportedQty"
         FROM "OrderItem" oi
         JOIN "Order" o ON o.id = oi."orderId"
         LEFT JOIN "ErpSaleExport" e ON e."orderId" = o.id
         WHERE oi."productId" = $1
           AND o.status = 'confirmed'
           AND (
             e."eventId" IS NULL
             OR e.status <> 'exported'
             OR (e."exportedAt" IS NOT NULL AND e."exportedAt" > $2)
           )`,
        [prod.id, input.erpUpdatedAt],
      );
      const unexportedQty = unexpRows[0]?.unexportedQty ?? 0;

      // 5. Conciliation:
      // ERP stock minus unexported confirmed sales prevents double-discount/oversell.
      const effectiveOnHand = Math.max(0, input.erpAvailable - unexportedQty);
      // Invariant: onHand must be >= reserved (PostgreSQL CHECK constraint)
      const finalOnHand = Math.max(reservedQty, effectiveOnHand);
      const effectiveAvailable = Math.max(0, finalOnHand - reservedQty);

      // 6. Update projection Inventory table only (never touch orders, payments, etc.)
      await client.query(
        `INSERT INTO "Inventory" (
           "productId", "warehouse", "onHand", "reserved", "sourceVersion", "syncedAt", "updatedAt"
         )
         VALUES ($1, 'demo-main', $2, $3, 1, $4, $5)
         ON CONFLICT ("productId") DO UPDATE
           SET "onHand" = $2,
               "reserved" = $3,
               "sourceVersion" = "Inventory"."sourceVersion" + 1,
               "syncedAt" = $4,
               "updatedAt" = $5`,
        [prod.id, finalOnHand, reservedQty, input.erpUpdatedAt, now],
      );

      await client.query("COMMIT");

      return {
        status: "updated",
        sku: input.sku,
        previousOnHand,
        newOnHand: finalOnHand,
        reserved: reservedQty,
        effectiveAvailable,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
