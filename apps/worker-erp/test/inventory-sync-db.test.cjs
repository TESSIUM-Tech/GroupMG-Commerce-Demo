const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const {
  PgInventoryProjectionRepository,
} = require("../dist/sync/inventory-projection.repository");
const {
  SyncInventoryUseCase,
} = require("../dist/sync/sync-inventory.use-case");

const runDbTests =
  process.env.ALLOW_DB_TESTS === "true" &&
  process.env.DATABASE_URL &&
  new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test");

test(
  "DEMO-13 (PostgreSQL): inventory projection repository and sync checkpoint persistence",
  { skip: !runDbTests },
  async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const repo = new PgInventoryProjectionRepository(pool);

    try {
      await repo.ensureSchema();

      // 1. Create isolated category and product for testing
      const categoryId = randomUUID();
      const productId = randomUUID();
      const testSku = `TEST-SYNC-${randomUUID().slice(0, 8)}`;

      await pool.query(
        `INSERT INTO "Category" ("id", "slug", "name") VALUES ($1, $2, 'Test Category')
         ON CONFLICT ("slug") DO NOTHING`,
        [categoryId, `cat-${testSku.toLowerCase()}`],
      );

      const actualCatId = (
        await pool.query(`SELECT "id" FROM "Category" WHERE "slug" = $1`, [
          `cat-${testSku.toLowerCase()}`,
        ])
      ).rows[0].id;

      await pool.query(
        `INSERT INTO "Product" (
           "id", "sku", "supplierReference", "name", "categoryId",
           "priceMinor", "currency", "taxRateBps", "imageUrl", "imageLicense", "published"
         )
         VALUES ($1, $2, $3, 'Test Sync Product', $4, 1000, 'USD', 1500, '/test.jpg', 'CC0', true)`,
        [productId, testSku, `sup-${testSku}`, actualCatId],
      );

      // 2. Initial reconcile: creates Inventory row
      const now = new Date();
      const res1 = await repo.reconcileItem({
        sku: testSku,
        erpAvailable: 25,
        erpUpdatedAt: now,
      });

      assert.equal(res1.status, "updated");
      assert.equal(res1.newOnHand, 25);
      assert.equal(res1.reserved, 0);

      // Verify row in database
      const { rows: invRows } = await pool.query(
        `SELECT "onHand", "reserved", "sourceVersion" FROM "Inventory" WHERE "productId" = $1`,
        [productId],
      );
      assert.equal(invRows[0].onHand, 25);
      assert.equal(invRows[0].reserved, 0);
      assert.equal(invRows[0].sourceVersion, 1);

      // 3. Stale snapshot rejection
      const staleDate = new Date(now.getTime() - 100_000);
      const resStale = await repo.reconcileItem({
        sku: testSku,
        erpAvailable: 5,
        erpUpdatedAt: staleDate,
      });
      assert.equal(resStale.status, "stale_snapshot_rejected");

      // Verify onHand was NOT updated to 5
      const { rows: invAfterStale } = await pool.query(
        `SELECT "onHand" FROM "Inventory" WHERE "productId" = $1`,
        [productId],
      );
      assert.equal(invAfterStale[0].onHand, 25);

      // 4. Test Checkpoint persistence
      const checkpointId = `chk-${randomUUID()}`;
      await repo.saveCheckpoint({
        id: checkpointId,
        cursor: "cursor-abc-123",
        pageIndex: 1,
        itemsSynced: 20,
        status: "in_progress",
        lastError: null,
      });

      const loaded = await repo.getCheckpoint(checkpointId);
      assert.ok(loaded);
      assert.equal(loaded.cursor, "cursor-abc-123");
      assert.equal(loaded.pageIndex, 1);
      assert.equal(loaded.itemsSynced, 20);
      assert.equal(loaded.status, "in_progress");

      // 5. Test full sync use case with fake ERP and recovery
      const fakeErp = {
        async getInventory(cursor) {
          if (!cursor) {
            return {
              items: [
                {
                  sku: testSku,
                  available: 40,
                  updatedAt: new Date().toISOString(),
                },
              ],
              nextCursor: undefined,
            };
          }
          return { items: [], nextCursor: undefined };
        },
        async postSale() {
          throw new Error("Not used");
        },
      };

      const syncUseCase = new SyncInventoryUseCase(repo, fakeErp);
      const syncResult = await syncUseCase.execute();

      assert.equal(syncResult.completed, true);
      assert.equal(syncResult.itemsUpdated, 1);

      // Verify onHand is now 40
      const { rows: finalRows } = await pool.query(
        `SELECT "onHand" FROM "Inventory" WHERE "productId" = $1`,
        [productId],
      );
      assert.equal(finalRows[0].onHand, 40);

      // Cleanup test data
      await pool.query(`DELETE FROM "Inventory" WHERE "productId" = $1`, [
        productId,
      ]);
      await pool.query(`DELETE FROM "Product" WHERE "id" = $1`, [productId]);
      await pool.query(`DELETE FROM "Category" WHERE "id" = $1`, [actualCatId]);
      await pool.query(`DELETE FROM "ErpSyncCheckpoint" WHERE "id" = $1`, [
        checkpointId,
      ]);
    } finally {
      await pool.end();
    }
  },
);
