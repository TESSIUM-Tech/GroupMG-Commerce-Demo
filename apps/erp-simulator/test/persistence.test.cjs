const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { readConfig } = require("../dist/config");
const { PostgresStore } = require("../dist/persistence/store");
const { SaleConflict } = require("../dist/sales/sale");
const { createSimulatorServer } = require("../dist/http/server");
const {
  SimulatedErpAdapter,
} = require("../../worker-erp/dist/adapters/simulated-erp/simulated-erp.adapter");

test(
  "PostgreSQL: concurrent deduplication, reconnect, restart, uncertain result and explicit reset",
  {
    skip:
      process.env.ALLOW_ERP_DB_TESTS !== "true"
        ? "Requires an isolated disposable erp_demo database and ALLOW_ERP_DB_TESTS=true; resets its ERP data"
        : false,
  },
  async () => {
    const config = readConfig();
    assert.equal(config.demo, true, "Integration reset requires ERP_ENV=demo");
    let pool = new Pool({ connectionString: config.databaseUrl });
    let store = new PostgresStore(pool);
    const fixture = [
      { sku: "SKU-001", stock: 5 },
      { sku: "SKU-002", stock: 0 },
      { sku: "SKU-003", stock: 10 },
    ];
    let server;
    const start = async (scenario = "normal") => {
      server = createSimulatorServer(store, {
        ...config,
        scenario,
        timeoutMs: 300,
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return new SimulatedErpAdapter({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        timeoutMs: scenario === "normal" ? 2000 : 100,
        pageSize: 2,
      });
    };
    const stop = async () => {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        server = undefined;
      }
    };
    try {
      await store.migrate();
      await store.seed(fixture, true);
      const adapter = await start();
      const first = await adapter.getInventory();
      const second = await adapter.getInventory(first.nextCursor);
      assert.deepEqual(
        [...first.items, ...second.items].map((x) => x.sku),
        fixture.map((x) => x.sku),
      );
      const input = {
        reference: "ORDER-DB-1",
        currency_code: "USD",
        gross_amount_minor: 1500,
      };
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          store.registerSale(input, `test-key-${String(i).padStart(16, "0")}`),
        ),
      );
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.equal(new Set(results.map((r) => r.sale.sale_id)).size, 1);
      const key = "test-key-0000000000000000";
      await assert.rejects(
        store.registerSale({ ...input, gross_amount_minor: 2000 }, key),
        SaleConflict,
      );
      await assert.rejects(
        store.registerSale({ ...input, reference: "OTHER" }, key),
        SaleConflict,
      );
      await store.seed(fixture, false);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM erp_sim.sales"))
          .rows[0].count,
        1,
      );
      await stop();
      await pool.end();
      pool = new Pool({ connectionString: config.databaseUrl });
      store = new PostgresStore(pool);
      await store.migrate();
      const restarted = await start();
      const replay = await restarted.postSale(
        { orderId: input.reference, currency: "USD", totalMinor: 1500 },
        key,
      );
      assert.equal(replay.externalId, results[0].sale.sale_id);
      await stop();
      const delayed = await start("timeout-after");
      await assert.rejects(
        delayed.postSale(
          { orderId: "TIMEOUT-DB", currency: "USD", totalMinor: 1000 },
          "timeout-db-key-00001",
        ),
      );
      await stop();
      const healthy = await start();
      const recovered = await healthy.postSale(
        { orderId: "TIMEOUT-DB", currency: "USD", totalMinor: 1000 },
        "timeout-db-key-00001",
      );
      assert.ok(recovered.externalId);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM erp_sim.sales"))
          .rows[0].count,
        2,
      );
      await store.seed(fixture, true);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM erp_sim.sales"))
          .rows[0].count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM erp_sim.sale_keys",
          )
        ).rows[0].count,
        0,
      );
      assert.equal((await store.inventory(undefined, 100)).records.length, 3);
    } finally {
      await stop();
      await pool.end();
    }
  },
);
