const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
const amqp = require("amqplib");
const { Pool } = require("pg");
const { ErpSalesConsumer } = require("../dist/messaging/erp-sales.consumer");
const {
  ErpSaleExportRepository,
} = require("../dist/exports/erp-sale-export.repository");
const { ExportSaleUseCase } = require("../dist/exports/export-sale.use-case");
const { ErpUnavailableError } = require("../dist/ports/erp.errors");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  process.env.ALLOW_RABBITMQ_TESTS !== "true" ||
  !process.env.RABBITMQ_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Consumer tests require commerce_issue2_test, a local RabbitMQ and ALLOW_DB_TESTS/ALLOW_RABBITMQ_TESTS=true",
  );
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await sleep(100);
  }
}

/** Idempotent fake ERP; `script` steps: "down", "lost", "hang". */
function fakeErp() {
  const sales = new Map();
  return {
    sales,
    calls: 0,
    script: [],
    release: null,
    async postSale(sale, key) {
      this.calls += 1;
      const step = this.script.shift();
      if (step === "down") throw new ErpUnavailableError("ERP timeout");
      if (!sales.has(key))
        sales.set(key, { ...sale, externalId: `ERP-${sales.size + 1}` });
      if (step === "lost") throw new ErpUnavailableError("response lost");
      if (step === "hang") await new Promise((done) => (this.release = done));
      return { externalId: sales.get(key).externalId };
    },
    async getInventory() {
      return { items: [] };
    },
  };
}

describe("ERP sales consumer with RabbitMQ and PostgreSQL", () => {
  let pool, admin, channel;
  const eventIds = [];
  const topologies = [];
  const consumers = [];
  const silent = () => undefined;

  before(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    admin = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await admin.createConfirmChannel();
  });

  after(async () => {
    for (const consumer of consumers) await consumer.stop();
    for (const t of topologies) {
      for (const queue of [t.queue, t.retryQueue, t.deadLetterQueue]) {
        await channel.deleteQueue(queue);
      }
      await channel.deleteExchange(t.exchange);
    }
    await channel.close();
    await admin.close();
    await pool.query(
      `DELETE FROM "ErpSaleExport" WHERE "eventId" = ANY($1::uuid[])`,
      [eventIds],
    );
    await pool.end();
  });

  function newTopology() {
    const suffix = randomUUID().slice(0, 8);
    const topology = {
      exchange: `test.worker.${suffix}`,
      routingKey: "order.confirmed.v1",
      queue: `test.worker.${suffix}.sales`,
      retryQueue: `test.worker.${suffix}.retry`,
      deadLetterQueue: `test.worker.${suffix}.dlq`,
      retryDelayMs: 300,
      maxDeliveryAttempts: 3,
    };
    topologies.push(topology);
    return topology;
  }

  async function startConsumer(topology, erp, dbPool = pool) {
    const consumer = new ErpSalesConsumer(
      process.env.RABBITMQ_URL,
      topology,
      new ExportSaleUseCase(
        new ErpSaleExportRepository(dbPool),
        erp,
        topology.maxDeliveryAttempts,
      ),
      silent,
    );
    await consumer.start();
    consumers.push(consumer);
    return consumer;
  }

  function saleEvent() {
    const eventId = randomUUID();
    eventIds.push(eventId);
    return {
      eventId,
      type: "order.confirmed.v1",
      occurredAt: new Date().toISOString(),
      correlationId: `corr-${eventId}`,
      data: {
        orderId: randomUUID(),
        currency: "USD",
        totalMinor: 3450,
        items: [{ sku: "MG-DEMO-001", quantity: 3, unitPriceMinor: 1000 }],
      },
    };
  }

  function publish(topology, event, body = JSON.stringify(event)) {
    return new Promise((done, fail) =>
      channel.publish(
        topology.exchange,
        topology.routingKey,
        Buffer.from(body),
        {
          persistent: true,
          mandatory: true,
          messageId: event.eventId,
          type: "order.confirmed.v1",
          correlationId: event.correlationId,
        },
        (error) => (error ? fail(error) : done()),
      ),
    );
  }

  const depth = async (queue) => (await channel.checkQueue(queue)).messageCount;

  async function row(eventId) {
    const result = await pool.query(
      `SELECT * FROM "ErpSaleExport" WHERE "eventId" = $1`,
      [eventId],
    );
    return result.rows[0];
  }

  test("a published sale is exported and acked only after it is recorded", async () => {
    const topology = newTopology();
    const erp = fakeErp();
    await startConsumer(topology, erp);
    const event = saleEvent();
    await publish(topology, event);
    const stored = await waitFor(async () => {
      const r = await row(event.eventId);
      return r?.status === "exported" ? r : null;
    });
    assert.equal(stored.erpReference, "ERP-1");
    await waitFor(async () => (await depth(topology.queue)) === 0);
    assert.equal(erp.sales.size, 1);
  });

  test("redelivered duplicates of an event create a single ERP sale", async () => {
    const topology = newTopology();
    const erp = fakeErp();
    await startConsumer(topology, erp);
    const event = saleEvent();
    for (let i = 0; i < 3; i += 1) await publish(topology, event);
    await waitFor(
      async () => (await depth(topology.queue)) === 0 && erp.calls >= 1,
    );
    await sleep(300);
    assert.equal(erp.sales.size, 1);
    assert.equal((await row(event.eventId)).status, "exported");
    assert.equal(await depth(topology.deadLetterQueue), 0);
  });

  test("an ERP outage goes through the retry queue and the sale is exported later", async () => {
    const topology = newTopology();
    const erp = fakeErp();
    erp.script = ["down", "down"];
    await startConsumer(topology, erp);
    const event = saleEvent();
    await publish(topology, event);
    const stored = await waitFor(async () => {
      const r = await row(event.eventId);
      return r?.status === "exported" ? r : null;
    });
    assert.equal(stored.attempts, 3, "third delivery succeeded");
    assert.equal(erp.calls, 3);
    assert.equal(erp.sales.size, 1);
  });

  test("when the ERP stays down the sale ends in the DLQ with its reason and history", async () => {
    const topology = newTopology();
    const erp = fakeErp();
    erp.script = ["down", "down", "down"];
    await startConsumer(topology, erp);
    const event = saleEvent();
    await publish(topology, event);
    await waitFor(async () => (await depth(topology.deadLetterQueue)) === 1);
    const dead = await channel.get(topology.deadLetterQueue, { noAck: false });
    assert.equal(dead.properties.messageId, event.eventId);
    assert.equal(dead.properties.correlationId, event.correlationId);
    assert.match(dead.properties.headers["x-dlq-reason"], /after 3 attempts/);
    assert.equal(dead.properties.headers["x-dlq-delivery-count"], 3);
    assert.equal(dead.properties.headers["x-original-queue"], topology.queue);
    assert.deepEqual(JSON.parse(dead.content.toString()), event);
    channel.ack(dead);
    assert.equal((await row(event.eventId)).status, "failed");
    assert.equal(await depth(topology.queue), 0);
    assert.equal(await depth(topology.retryQueue), 0);
  });

  test("an invalid message goes straight to the DLQ and never reaches the ERP", async () => {
    const topology = newTopology();
    const erp = fakeErp();
    await startConsumer(topology, erp);
    const event = saleEvent();
    await publish(topology, event, '{"eventId":"broken"');
    await waitFor(async () => (await depth(topology.deadLetterQueue)) === 1);
    const dead = await channel.get(topology.deadLetterQueue, { noAck: true });
    assert.equal(dead.properties.headers["x-dlq-reason"], "invalid_json");
    assert.equal(erp.calls, 0);
  });

  test("without the database the message is never acked or lost", async () => {
    const topology = newTopology();
    const erp = fakeErp();
    const broken = new Pool({
      connectionString: process.env.DATABASE_URL.replace(/:\d+\//, ":5439/"),
      connectionTimeoutMillis: 500,
    });
    const consumer = await startConsumer(topology, erp, broken);
    const event = saleEvent();
    await publish(topology, event);
    await sleep(800);
    await consumer.stop();
    await broken.end();
    const waiting =
      (await depth(topology.queue)) + (await depth(topology.retryQueue));
    assert.equal(waiting, 1, "the sale is still in RabbitMQ");
    assert.equal(await depth(topology.deadLetterQueue), 0);
    assert.equal(erp.calls, 0);
    // Database back: a new consumer exports it.
    await startConsumer(topology, erp);
    await waitFor(
      async () => (await row(event.eventId))?.status === "exported",
    );
  });

  test("a worker that dies mid-export gets the sale redelivered without a duplicate sale", async () => {
    const topology = newTopology();
    const erp = fakeErp();
    erp.script = ["hang"];
    const first = await startConsumer(topology, erp);
    const event = saleEvent();
    await publish(topology, event);
    await waitFor(() => erp.release !== null);
    // ERP already registered the sale; the worker dies before recording/acking.
    await first.stop();
    erp.release();
    await startConsumer(topology, erp);
    const stored = await waitFor(async () => {
      const r = await row(event.eventId);
      return r?.status === "exported" ? r : null;
    });
    assert.equal(erp.sales.size, 1, "redelivery did not duplicate the sale");
    assert.equal(stored.erpReference, "ERP-1");
  });
});
