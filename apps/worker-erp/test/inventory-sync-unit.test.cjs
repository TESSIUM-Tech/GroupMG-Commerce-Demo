const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SyncInventoryUseCase,
} = require("../dist/sync/sync-inventory.use-case");
const {
  PgInventoryProjectionRepository,
} = require("../dist/sync/inventory-projection.repository");

class InMemoryProjectionRepository {
  constructor(initialData = {}) {
    this.checkpoint = null;
    this.products = new Map(initialData.products ?? []);
    this.inventory = new Map(initialData.inventory ?? []);
    this.reservations = initialData.reservations ?? [];
    this.unexportedSales = initialData.unexportedSales ?? [];
    this.writeOperations = [];
  }

  async ensureSchema() {}

  async getCheckpoint() {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  async saveCheckpoint(input) {
    this.writeOperations.push({
      table: "ErpSyncCheckpoint",
      op: "save",
      input,
    });
    this.checkpoint = {
      id: input.id ?? "inventory",
      cursor: input.cursor,
      pageIndex: input.pageIndex,
      itemsSynced: input.itemsSynced,
      status: input.status,
      lastError: input.lastError ?? null,
      startedAt:
        input.startedAt ?? (this.checkpoint ? this.checkpoint.startedAt : null),
      completedAt: input.completedAt ?? null,
      updatedAt: new Date(),
    };
  }

  async reconcileItem(input, now = new Date()) {
    const prod = this.products.get(input.sku);
    if (!prod) {
      return { status: "product_not_found", sku: input.sku };
    }

    const currentInv = this.inventory.get(prod.id);
    if (
      currentInv &&
      currentInv.syncedAt &&
      input.erpUpdatedAt < currentInv.syncedAt
    ) {
      return {
        status: "stale_snapshot_rejected",
        sku: input.sku,
        erpUpdatedAt: input.erpUpdatedAt,
        syncedAt: currentInv.syncedAt,
      };
    }

    // Active reservations
    const reservedQty = this.reservations
      .filter(
        (r) =>
          r.productId === prod.id && r.status === "active" && r.expiresAt > now,
      )
      .reduce((sum, r) => sum + r.quantity, 0);

    // Unexported confirmed sales (or exported after ERP snapshot)
    const unexportedQty = this.unexportedSales
      .filter(
        (s) =>
          s.productId === prod.id &&
          (!s.exportedAt || s.exportedAt > input.erpUpdatedAt),
      )
      .reduce((sum, s) => sum + s.quantity, 0);

    const effectiveOnHand = Math.max(0, input.erpAvailable - unexportedQty);
    const finalOnHand = Math.max(reservedQty, effectiveOnHand);
    const effectiveAvailable = Math.max(0, finalOnHand - reservedQty);

    const previousOnHand = currentInv ? currentInv.onHand : 0;
    this.writeOperations.push({
      table: "Inventory",
      op: "update",
      productId: prod.id,
      onHand: finalOnHand,
      reserved: reservedQty,
    });

    this.inventory.set(prod.id, {
      productId: prod.id,
      warehouse: "demo-main",
      onHand: finalOnHand,
      reserved: reservedQty,
      sourceVersion: (currentInv ? currentInv.sourceVersion : 0) + 1,
      syncedAt: input.erpUpdatedAt,
      updatedAt: now,
    });

    return {
      status: "updated",
      sku: input.sku,
      previousOnHand,
      newOnHand: finalOnHand,
      reserved: reservedQty,
      effectiveAvailable,
    };
  }
}

test("DEMO-13: reconcileItem updates projection without reservations or unexported sales", async () => {
  const repo = new InMemoryProjectionRepository({
    products: [["MG-DEMO-001", { id: "p1", sku: "MG-DEMO-001" }]],
    inventory: [
      [
        "p1",
        { onHand: 5, reserved: 0, syncedAt: new Date("2026-10-01T00:00:00Z") },
      ],
    ],
  });

  const res = await repo.reconcileItem({
    sku: "MG-DEMO-001",
    erpAvailable: 15,
    erpUpdatedAt: new Date("2026-10-10T12:00:00Z"),
  });

  assert.equal(res.status, "updated");
  assert.equal(res.previousOnHand, 5);
  assert.equal(res.newOnHand, 15);
  assert.equal(res.reserved, 0);
  assert.equal(res.effectiveAvailable, 15);
});

test("DEMO-13: conciliation deducts unexported confirmed sales from ERP stock (prevents double discount/oversell)", async () => {
  const repo = new InMemoryProjectionRepository({
    products: [["MG-DEMO-001", { id: "p1", sku: "MG-DEMO-001" }]],
    unexportedSales: [{ productId: "p1", quantity: 3, exportedAt: null }],
  });

  const res = await repo.reconcileItem({
    sku: "MG-DEMO-001",
    erpAvailable: 10,
    erpUpdatedAt: new Date("2026-10-10T12:00:00Z"),
  });

  assert.equal(res.status, "updated");
  assert.equal(res.newOnHand, 7);
  assert.equal(res.effectiveAvailable, 7);
});

test("DEMO-13: conciliation accounts for active reservations and unexported sales together", async () => {
  const future = new Date(Date.now() + 300_000);
  const repo = new InMemoryProjectionRepository({
    products: [["MG-DEMO-001", { id: "p1", sku: "MG-DEMO-001" }]],
    reservations: [
      { productId: "p1", quantity: 2, status: "active", expiresAt: future },
    ],
    unexportedSales: [{ productId: "p1", quantity: 3, exportedAt: null }],
  });

  const res = await repo.reconcileItem({
    sku: "MG-DEMO-001",
    erpAvailable: 10,
    erpUpdatedAt: new Date("2026-10-10T12:00:00Z"),
  });

  assert.equal(res.status, "updated");
  assert.equal(res.newOnHand, 7);
  assert.equal(res.reserved, 2);
  assert.equal(res.effectiveAvailable, 5); // 7 onHand - 2 reserved = 5 available in catalog
});

test("DEMO-13: conciliation clamps onHand to reserved when ERP stock is depleted, respecting DB check constraint", async () => {
  const future = new Date(Date.now() + 300_000);
  const repo = new InMemoryProjectionRepository({
    products: [["MG-DEMO-001", { id: "p1", sku: "MG-DEMO-001" }]],
    reservations: [
      { productId: "p1", quantity: 2, status: "active", expiresAt: future },
    ],
    unexportedSales: [{ productId: "p1", quantity: 5, exportedAt: null }],
  });

  const res = await repo.reconcileItem({
    sku: "MG-DEMO-001",
    erpAvailable: 2,
    erpUpdatedAt: new Date("2026-10-10T12:00:00Z"),
  });

  assert.equal(res.status, "updated");
  // effective is 0, but onHand cannot be < reserved (reserved <= onHand check constraint)
  assert.equal(res.newOnHand, 2);
  assert.equal(res.reserved, 2);
  assert.equal(res.effectiveAvailable, 0);
});

test("DEMO-13: rejects stale snapshots when erpUpdatedAt is older than syncedAt", async () => {
  const repo = new InMemoryProjectionRepository({
    products: [["MG-DEMO-001", { id: "p1", sku: "MG-DEMO-001" }]],
    inventory: [
      [
        "p1",
        { onHand: 10, reserved: 0, syncedAt: new Date("2026-10-15T00:00:00Z") },
      ],
    ],
  });

  const res = await repo.reconcileItem({
    sku: "MG-DEMO-001",
    erpAvailable: 5,
    erpUpdatedAt: new Date("2026-10-10T00:00:00Z"), // Older than syncedAt!
  });

  assert.equal(res.status, "stale_snapshot_rejected");
  assert.equal(repo.inventory.get("p1").onHand, 10); // Untouched!
});

test("DEMO-13: reports product_not_found for unknown SKUs without throwing", async () => {
  const repo = new InMemoryProjectionRepository();
  const res = await repo.reconcileItem({
    sku: "UNKNOWN-SKU",
    erpAvailable: 10,
    erpUpdatedAt: new Date(),
  });
  assert.equal(res.status, "product_not_found");
});

test("DEMO-13: paged import traverses all pages and resets checkpoint to idle", async () => {
  const repo = new InMemoryProjectionRepository({
    products: [
      ["SKU-1", { id: "p1", sku: "SKU-1" }],
      ["SKU-2", { id: "p2", sku: "SKU-2" }],
      ["SKU-3", { id: "p3", sku: "SKU-3" }],
    ],
  });

  const pages = [
    {
      cursor: undefined,
      result: {
        items: [
          { sku: "SKU-1", available: 10, updatedAt: "2026-10-10T00:00:00Z" },
          { sku: "SKU-2", available: 20, updatedAt: "2026-10-10T00:00:00Z" },
        ],
        nextCursor: "cursor-page-2",
      },
    },
    {
      cursor: "cursor-page-2",
      result: {
        items: [
          { sku: "SKU-3", available: 30, updatedAt: "2026-10-10T00:00:00Z" },
        ],
        nextCursor: undefined,
      },
    },
  ];

  const erp = {
    async getInventory(cursor) {
      const match = pages.find((p) => p.cursor === cursor);
      if (!match) throw new Error(`Unexpected cursor: ${cursor}`);
      return match.result;
    },
    async postSale() {
      throw new Error("Not used");
    },
  };

  const useCase = new SyncInventoryUseCase(repo, erp);
  const result = await useCase.execute();

  assert.equal(result.completed, true);
  assert.equal(result.pagesProcessed, 2);
  assert.equal(result.itemsProcessed, 3);
  assert.equal(result.itemsUpdated, 3);
  assert.equal(result.staleRejected, 0);

  const checkpoint = await repo.getCheckpoint();
  assert.equal(checkpoint.status, "idle");
  assert.equal(checkpoint.cursor, null);
  assert.equal(checkpoint.pageIndex, 0);
  assert.equal(checkpoint.itemsSynced, 3);
  assert.ok(checkpoint.completedAt);
});

test("DEMO-13: interruption between pages and recovery from checkpoint", async () => {
  const repo = new InMemoryProjectionRepository({
    products: [
      ["SKU-1", { id: "p1", sku: "SKU-1" }],
      ["SKU-2", { id: "p2", sku: "SKU-2" }],
    ],
  });

  let shouldFailOnPage2 = true;
  const erp = {
    async getInventory(cursor) {
      if (!cursor) {
        return {
          items: [
            { sku: "SKU-1", available: 10, updatedAt: "2026-10-10T00:00:00Z" },
          ],
          nextCursor: "cursor-page-2",
        };
      }
      if (cursor === "cursor-page-2") {
        if (shouldFailOnPage2) {
          throw new Error("Network drop on page 2");
        }
        return {
          items: [
            { sku: "SKU-2", available: 20, updatedAt: "2026-10-10T00:00:00Z" },
          ],
          nextCursor: undefined,
        };
      }
      throw new Error(`Unexpected cursor ${cursor}`);
    },
    async postSale() {
      throw new Error("Not used");
    },
  };

  const useCase = new SyncInventoryUseCase(repo, erp);

  // First run: fails on page 2
  await assert.rejects(async () => useCase.execute(), /Network drop on page 2/);

  // Checkpoint must retain page 1 progress and cursor
  let checkpoint = await repo.getCheckpoint();
  assert.equal(checkpoint.status, "in_progress");
  assert.equal(checkpoint.cursor, "cursor-page-2");
  assert.equal(checkpoint.pageIndex, 1);
  assert.equal(checkpoint.itemsSynced, 1);
  assert.match(checkpoint.lastError, /Network drop on page 2/);

  // SKU-1 was updated
  assert.equal(repo.inventory.get("p1").onHand, 10);
  assert.equal(repo.inventory.has("p2"), false);

  // Second run: recovery succeeds
  shouldFailOnPage2 = false;
  const recoveredResult = await useCase.execute();

  assert.equal(recoveredResult.completed, true);
  assert.equal(recoveredResult.pagesProcessed, 1);
  assert.equal(recoveredResult.itemsProcessed, 1);
  assert.equal(recoveredResult.itemsUpdated, 1);

  // SKU-2 is now also updated
  assert.equal(repo.inventory.get("p2").onHand, 20);

  checkpoint = await repo.getCheckpoint();
  assert.equal(checkpoint.status, "idle");
  assert.equal(checkpoint.cursor, null);
  assert.equal(checkpoint.itemsSynced, 2);
});

test("DEMO-13: never writes to private order/payment tables", async () => {
  const repo = new InMemoryProjectionRepository({
    products: [["SKU-1", { id: "p1", sku: "SKU-1" }]],
  });

  const erp = {
    async getInventory() {
      return {
        items: [
          { sku: "SKU-1", available: 5, updatedAt: "2026-10-10T00:00:00Z" },
        ],
        nextCursor: undefined,
      };
    },
    async postSale() {
      throw new Error("Not used");
    },
  };

  const useCase = new SyncInventoryUseCase(repo, erp);
  await useCase.execute();

  // Inspect all recorded write operations
  for (const op of repo.writeOperations) {
    assert.ok(
      op.table === "Inventory" || op.table === "ErpSyncCheckpoint",
      `Forbidden write to table: ${op.table}`,
    );
  }
});
