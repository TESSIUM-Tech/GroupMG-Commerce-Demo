const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  loadWorkerConfig,
  WorkerConfigError,
} = require("../dist/config/worker.config");
const {
  validateOrderConfirmedV1,
  isOrderConfirmedV1,
} = require("../dist/contracts/order-confirmed");
const { ERP_SALES_TOPOLOGY } = require("../dist/messaging/rabbitmq-topology");

function event(overrides = {}, dataOverrides = {}) {
  return {
    eventId: randomUUID(),
    type: "order.confirmed.v1",
    occurredAt: new Date().toISOString(),
    correlationId: "corr-1",
    data: {
      orderId: randomUUID(),
      currency: "USD",
      totalMinor: 3450,
      items: [{ sku: "MG-DEMO-001", quantity: 3, unitPriceMinor: 1000 }],
      ...dataOverrides,
    },
    ...overrides,
  };
}

test("the worker topology is the same one the API declares", () => {
  const api = require("../../api/dist/messaging/rabbitmq-topology");
  assert.deepEqual(ERP_SALES_TOPOLOGY, api.ERP_SALES_TOPOLOGY);
});

test("without broker, database or ERP adapter the worker stays idle", () => {
  assert.deepEqual(loadWorkerConfig({}), {
    databaseUrl: null,
    rabbitmqUrl: null,
    erpAdapter: "none",
  });
  const config = loadWorkerConfig({
    DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
    RABBITMQ_URL: "amqp://u:p@127.0.0.1:5672",
  });
  assert.equal(config.erpAdapter, "none");
});

test("invalid worker configuration names the variable, never its value", () => {
  for (const env of [
    { DATABASE_URL: "mysql://u:secret-pass@h/db" },
    { RABBITMQ_URL: "http://u:secret-pass@h:5672" },
    { ERP_ADAPTER: "sap" },
  ]) {
    assert.throws(
      () => loadWorkerConfig(env),
      (error) =>
        error instanceof WorkerConfigError &&
        !error.message.includes("secret-pass"),
    );
  }
});

test("a well-formed order.confirmed.v1 event is accepted", () => {
  const valid = event();
  assert.deepEqual(validateOrderConfirmedV1(valid), []);
  assert.equal(isOrderConfirmedV1(valid), true);
});

test("malformed events are rejected with the reason", () => {
  const cases = [
    [null, /JSON object/],
    ["text", /JSON object/],
    [event({ eventId: "not-a-uuid" }), /eventId/],
    [event({ type: "order.created.v1" }), /type/],
    [event({ occurredAt: "yesterday" }), /occurredAt/],
    [event({ correlationId: "" }), /correlationId/],
    [event({ data: "x" }), /data must be an object/],
    [event({}, { orderId: "1" }), /orderId/],
    [event({}, { currency: "usd" }), /currency/],
    [event({}, { totalMinor: 0 }), /totalMinor/],
    [event({}, { totalMinor: 12.5 }), /totalMinor/],
    [event({}, { totalMinor: "3450" }), /totalMinor/],
    [event({}, { items: [] }), /items/],
    [
      event({}, { items: [{ sku: "A", quantity: 0, unitPriceMinor: 1 }] }),
      /items\[0\]/,
    ],
    [event({}, { items: [{ quantity: 1, unitPriceMinor: 1 }] }), /items\[0\]/],
  ];
  for (const [value, expected] of cases) {
    const problems = validateOrderConfirmedV1(value);
    assert.ok(problems.length > 0, JSON.stringify(value));
    assert.match(problems.join("; "), expected);
    assert.equal(isOrderConfirmedV1(value), false);
  }
});
