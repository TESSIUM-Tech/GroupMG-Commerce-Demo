const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSimulatorServer } = require("../dist/http/server");

test("Swagger serves the ERP contract and local assets even while demo faults are enabled", async () => {
  const store = {
    ping: async () => {
      throw new Error("offline");
    },
    inventory: async () => {
      throw new Error("must not read inventory for docs");
    },
    registerSale: async () => {
      throw new Error("must not register sales for docs");
    },
  };
  const server = createSimulatorServer(store, {
    demo: true,
    scenario: "unavailable",
    latencyMs: 0,
    timeoutMs: 100,
    port: 3003,
    databaseUrl: "unused",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/openapi.json`);
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(document.openapi, "3.0.3");
    assert.deepEqual(Object.keys(document.paths).sort(), [
      "/health",
      "/v1/inventory",
      "/v1/sales",
    ]);
    const inventory = document.paths["/v1/inventory"].get;
    assert.equal(
      inventory.parameters.find((p) => p.name === "limit").schema.maximum,
      100,
    );
    assert.equal(
      inventory.parameters.find((p) => p.name === "limit").schema.default,
      20,
    );
    const sale = document.paths["/v1/sales"].post;
    assert.equal(sale.parameters[0].required, true);
    assert.equal(sale.parameters[0].name, "Idempotency-Key");
    for (const code of [200, 201, 400, 409, 413, 415, 503, 504])
      assert.ok(sale.responses[code]);
    assert.equal(
      document.components.schemas.SaleInput.additionalProperties,
      false,
    );
    assert.equal(
      document.components.schemas.SaleInput.properties.gross_amount_minor
        .maximum,
      2147483647,
    );
    assert.equal(
      document.components.schemas.InventoryPage.properties.next_cursor.nullable,
      true,
    );
    const checkRefs = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.$ref)
        assert.ok(
          document.components.schemas[node.$ref.split("/").at(-1)],
          `Unresolved ${node.$ref}`,
        );
      for (const child of Object.values(node)) checkRefs(child);
    };
    checkRefs(document);
    for (const path of ["/docs", "/docs/"]) {
      const ui = await fetch(base + path);
      assert.equal(ui.status, 200);
      assert.match(ui.headers.get("content-type"), /text\/html/);
      assert.match(await ui.text(), /\/docs\/swagger-ui-bundle.js/);
    }
    for (const path of [
      "/docs/swagger-ui.css",
      "/docs/swagger-ui-bundle.js",
      "/docs/initialize.js",
    ]) {
      const asset = await fetch(base + path);
      assert.equal(asset.status, 200);
      assert.ok((await asset.text()).length > 20);
    }
    const init = await (await fetch(base + "/docs/initialize.js")).text();
    assert.match(init, /url: '\/openapi.json'/);
    assert.match(init, /validatorUrl: null/);
    assert.equal(
      (await fetch(base + "/openapi.json", { method: "HEAD" })).status,
      200,
    );
    assert.equal((await fetch(base + "/docs/package.json")).status, 404);
    assert.equal(
      (await fetch(base + "/docs/..%2F..%2Fpackage.json")).status,
      404,
    );
    assert.equal((await fetch(base + "/health")).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
