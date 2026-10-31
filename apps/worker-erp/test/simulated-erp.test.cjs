const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SimulatedErpAdapter,
} = require("../dist/adapters/simulated-erp/simulated-erp.adapter");
const {
  ErpContractError,
  ErpConflictError,
  ErpUnavailableError,
  ErpRequestError,
} = require("../dist/ports/erp.errors");
const options = { baseUrl: "http://erp.invalid", timeoutMs: 100 };
const sale = { orderId: "order-1", currency: "USD", totalMinor: 19900 };

test("ACL maps provider fields without exposing transport DTO", async () => {
  const calls = [];
  const adapter = new SimulatedErpAdapter(options, async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(
        url.includes("inventory")
          ? {
              records: [
                {
                  product_code: "MG-DEMO-001",
                  quantity_available: 5,
                  modified_at: "2026-01-01T00:00:00Z",
                },
              ],
              next_cursor: null,
            }
          : {
              sale_id: "11111111-1111-4111-8111-111111111111",
              reference: "order-1",
            },
      ),
    );
  });
  assert.deepEqual(await adapter.getInventory(), {
    items: [
      {
        sku: "MG-DEMO-001",
        available: 5,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(await adapter.postSale(sale, "idempotency-key-0001"), {
    externalId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(
    calls[1].init.headers["Idempotency-Key"],
    "idempotency-key-0001",
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    reference: "order-1",
    currency_code: "USD",
    gross_amount_minor: 19900,
  });
});

test("ACL translates errors and rejects malformed provider responses", async () => {
  for (const [status, error] of [
    [409, ErpConflictError],
    [503, ErpUnavailableError],
    [400, ErpRequestError],
  ]) {
    await assert.rejects(
      new SimulatedErpAdapter(
        options,
        async () => new Response("{}", { status }),
      ).getInventory(),
      error,
    );
  }
  await assert.rejects(
    new SimulatedErpAdapter(options, async () => {
      throw new TypeError("offline");
    }).getInventory(),
    ErpUnavailableError,
  );
  for (const body of [
    "not-json",
    "{}",
    JSON.stringify({
      records: [
        { product_code: "SKU", quantity_available: -1, modified_at: "bad" },
      ],
      next_cursor: null,
    }),
  ]) {
    await assert.rejects(
      new SimulatedErpAdapter(
        options,
        async () => new Response(body),
      ).getInventory(),
      ErpContractError,
    );
  }
  await assert.rejects(
    new SimulatedErpAdapter(
      options,
      async () =>
        new Response(
          JSON.stringify({ sale_id: "invalid", reference: "order-1" }),
        ),
    ).postSale(sale, "key-000000000001"),
    ErpContractError,
  );
});
