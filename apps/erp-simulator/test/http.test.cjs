const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createSimulatorServer } = require("../dist/http/server");
const { readConfig } = require("../dist/config");
const { requireDemoAction } = require("../dist/demo/manage");
const {
  SimulatedErpAdapter,
} = require("../../worker-erp/dist/adapters/simulated-erp/simulated-erp.adapter");
const {
  ErpUnavailableError,
} = require("../../worker-erp/dist/ports/erp.errors");
const { SaleConflict } = require("../dist/sales/sale");

const config = {
  databaseUrl: "unused",
  port: 3003,
  demo: true,
  scenario: "normal",
  latencyMs: 0,
  timeoutMs: 150,
};
function fixtureStore() {
  const keys = new Map();
  const refs = new Map();
  return {
    ping: async () => {},
    inventory: async (after, limit) => {
      const items = ["SKU-001", "SKU-002", "SKU-003"].filter(
        (s) => !after || s > after,
      );
      return {
        records: items
          .slice(0, limit)
          .map((product_code) => ({
            product_code,
            quantity_available: 3,
            modified_at: "2026-01-01T00:00:00Z",
          })),
        next_cursor:
          items.length > limit
            ? Buffer.from(items[limit - 1]).toString("base64url")
            : null,
      };
    },
    registerSale: async (input, key) => {
      const hash = JSON.stringify(input);
      const old = keys.get(key) ?? refs.get(input.reference);
      if (old && old.hash !== hash) throw new SaleConflict("conflict");
      const entry = old ?? {
        hash,
        sale: { sale_id: randomUUID(), reference: input.reference },
      };
      keys.set(key, entry);
      refs.set(input.reference, entry);
      return { sale: entry.sale, created: !old };
    },
  };
}
async function start(store, scenario = "normal", latencyMs = 0) {
  const server = createSimulatorServer(store, {
    ...config,
    scenario,
    latencyMs,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("HTTP and ErpPort paginate, validate requests and deduplicate sale references", async () => {
  const { server, base } = await start(fixtureStore());
  try {
    const adapter = new SimulatedErpAdapter({
      baseUrl: base,
      timeoutMs: 2000,
      pageSize: 2,
    });
    const first = await adapter.getInventory();
    const second = await adapter.getInventory(first.nextCursor);
    assert.deepEqual(
      [...first.items, ...second.items].map((x) => x.sku),
      ["SKU-001", "SKU-002", "SKU-003"],
    );
    assert.equal(second.nextCursor, undefined);
    for (const query of [
      "limit=0",
      "cursor=invalid!",
      "limit=1&limit=2",
      "unknown=x",
    ]) {
      assert.equal((await fetch(`${base}/v1/inventory?${query}`)).status, 400);
    }
    const sale = { orderId: "ORDER-1", currency: "USD", totalMinor: 1500 };
    const a = await adapter.postSale(sale, "key-0000000000001");
    assert.deepEqual(await adapter.postSale(sale, "key-0000000000001"), a);
    assert.deepEqual(await adapter.postSale(sale, "key-0000000000002"), a);
    const request = (body, key) =>
      fetch(`${base}/v1/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await request(
          {
            reference: "ORDER-1",
            currency_code: "USD",
            gross_amount_minor: 2000,
          },
          "key-0000000000001",
        )
      ).status,
      409,
    );
    assert.equal((await request({}, "short")).status, 400);
    assert.equal(
      (
        await request(
          {
            reference: "ORDER-X",
            currency_code: "USD",
            gross_amount_minor: 1500,
            extra: true,
          },
          "key-0000000000003",
        )
      ).status,
      400,
    );
  } finally {
    await close(server);
  }
});

test("demo latency, 503 and both timeout scenarios are observable through ErpPort", async () => {
  for (const scenario of ["unavailable", "timeout-before", "timeout-after"]) {
    const store = fixtureStore();
    const { server, base } = await start(store, scenario);
    try {
      const adapter = new SimulatedErpAdapter({ baseUrl: base, timeoutMs: 50 });
      await assert.rejects(
        adapter.postSale(
          { orderId: "ORDER-T", currency: "USD", totalMinor: 1000 },
          "key-timeout-000001",
        ),
        ErpUnavailableError,
      );
      if (scenario === "timeout-after") {
        const result = await store.registerSale(
          {
            reference: "ORDER-T",
            currency_code: "USD",
            gross_amount_minor: 1000,
          },
          "key-timeout-000001",
        );
        assert.equal(result.created, false);
      }
      assert.equal((await fetch(`${base}/health`)).status, 200);
    } finally {
      await close(server);
    }
  }
  const { server, base } = await start(fixtureStore(), "normal", 40);
  try {
    const startTime = Date.now();
    await fetch(`${base}/v1/inventory`);
    assert.ok(Date.now() - startTime >= 35);
  } finally {
    await close(server);
  }
});

test("faults and reset are guarded by explicit demo configuration", () => {
  const env = { ERP_DATABASE_URL: "postgresql://u:p@localhost/erp_demo" };
  assert.throws(() => readConfig({ ...env, ERP_DEMO_SCENARIO: "unavailable" }));
  assert.throws(() => readConfig({ ...env, ERP_DEMO_LATENCY_MS: "5" }));
  assert.throws(() =>
    readConfig({
      ...env,
      ERP_DATABASE_URL: "postgresql://u:p@localhost/commerce",
    }),
  );
  assert.throws(() =>
    requireDemoAction({ demo: false }, ["reset", "--confirm-erp-demo-reset"]),
  );
  assert.throws(() => requireDemoAction({ demo: true }, ["reset"]));
  assert.equal(
    requireDemoAction({ demo: true }, ["reset", "--confirm-erp-demo-reset"]),
    "reset",
  );
});
