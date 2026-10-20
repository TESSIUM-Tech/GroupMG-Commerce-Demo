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
const {
  listDeadLetters,
  reprocessDeadLetters,
} = require("../dist/messaging/dead-letter-tools");
const {
  assertErpSalesTopology,
} = require("../dist/messaging/rabbitmq-topology");
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
    "DLQ tests require commerce_issue2_test, a local RabbitMQ and ALLOW_DB_TESTS/ALLOW_RABBITMQ_TESTS=true",
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

describe("DLQ inspection and reprocessing", () => {
  let pool, connection;
  const eventIds = [];
  const topologies = [];
  const consumers = [];

  before(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    connection = await amqp.connect(process.env.RABBITMQ_URL);
  });

  after(async () => {
    for (const consumer of consumers) await consumer.stop();
    const channel = await connection.createChannel();
    for (const t of topologies) {
      for (const queue of [t.queue, t.retryQueue, t.deadLetterQueue]) {
        await channel.deleteQueue(queue);
      }
      await channel.deleteExchange(t.exchange);
    }
    await connection.close();
    await pool.query(
      `DELETE FROM "ErpSaleExport" WHERE "eventId" = ANY($1::uuid[])`,
      [eventIds],
    );
    await pool.end();
  });

  async function newTopology() {
    const suffix = randomUUID().slice(0, 8);
    const topology = {
      exchange: `test.dlq.${suffix}`,
      routingKey: "order.confirmed.v1",
      queue: `test.dlq.${suffix}.sales`,
      retryQueue: `test.dlq.${suffix}.retry`,
      deadLetterQueue: `test.dlq.${suffix}.dlq`,
      retryDelayMs: 200,
      maxDeliveryAttempts: 2,
    };
    topologies.push(topology);
    const channel = await connection.createConfirmChannel();
    await assertErpSalesTopology(channel, topology);
    await channel.close();
    return topology;
  }

  /** A fresh confirm channel per operation, like the CLI does. */
  async function withChannel(fn) {
    const channel = await connection.createConfirmChannel();
    try {
      return await fn(channel);
    } finally {
      await channel.close();
    }
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

  /** Puts a sale in the DLQ as the consumer would after its last attempt. */
  function deadLetter(
    topology,
    event,
    reason = "erp_unavailable after 2 attempts",
  ) {
    return withChannel(
      (channel) =>
        new Promise((done, fail) =>
          channel.sendToQueue(
            topology.deadLetterQueue,
            Buffer.from(JSON.stringify(event)),
            {
              persistent: true,
              messageId: event.eventId,
              correlationId: event.correlationId,
              type: "order.confirmed.v1",
              headers: {
                "x-death": [
                  { queue: topology.queue, reason: "rejected", count: 1 },
                ],
                "x-dlq-reason": reason,
                "x-dlq-at": "2026-10-15T10:00:00.000Z",
                "x-dlq-delivery-count": 2,
                "x-original-queue": topology.queue,
              },
            },
            (error) => (error ? fail(error) : done()),
          ),
        ),
    );
  }

  const depth = (queue) =>
    withChannel(
      async (channel) => (await channel.checkQueue(queue)).messageCount,
    );

  test("listing shows reason, attempts and ids without removing anything", async () => {
    const topology = await newTopology();
    const first = saleEvent();
    const second = saleEvent();
    await deadLetter(topology, first);
    await deadLetter(topology, second, "erp_rejected: unknown SKU");
    const listed = await withChannel((channel) =>
      listDeadLetters(channel, topology),
    );
    assert.deepEqual(
      listed.map((s) => [
        s.eventId,
        s.correlationId,
        s.reason,
        s.deliveryCount,
        s.reprocessCount,
      ]),
      [
        [
          first.eventId,
          first.correlationId,
          "erp_unavailable after 2 attempts",
          2,
          0,
        ],
        [
          second.eventId,
          second.correlationId,
          "erp_rejected: unknown SKU",
          2,
          0,
        ],
      ],
    );
    assert.equal(
      await depth(topology.deadLetterQueue),
      2,
      "list never drains the DLQ",
    );
  });

  test("reprocessing one sale keeps its ids and history and leaves the rest in the DLQ", async () => {
    const topology = await newTopology();
    const chosen = saleEvent();
    const other = saleEvent();
    await deadLetter(topology, chosen);
    await deadLetter(topology, other);
    const done = await withChannel((channel) =>
      reprocessDeadLetters(
        channel,
        topology,
        (s) => s.eventId === chosen.eventId,
      ),
    );
    assert.deepEqual(
      done.map((s) => s.eventId),
      [chosen.eventId],
    );
    assert.equal(await depth(topology.deadLetterQueue), 1);
    const back = await withChannel(async (channel) => {
      const message = await channel.get(topology.queue, { noAck: true });
      return message;
    });
    assert.equal(back.properties.messageId, chosen.eventId);
    assert.equal(back.properties.correlationId, chosen.correlationId);
    assert.deepEqual(JSON.parse(back.content.toString()), chosen);
    const headers = back.properties.headers;
    assert.equal(headers["x-death"], undefined, "fresh attempt budget");
    assert.equal(headers["x-dlq-reason"], undefined);
    assert.ok(headers["x-reprocessed-at"]);
    assert.deepEqual(headers["x-dlq-history"], [
      {
        reason: "erp_unavailable after 2 attempts",
        at: "2026-10-15T10:00:00.000Z",
        deliveryCount: 2,
      },
    ]);
    assert.equal(headers["x-original-queue"], topology.queue);
  });

  test("an unknown eventId changes nothing", async () => {
    const topology = await newTopology();
    await deadLetter(topology, saleEvent());
    const done = await withChannel((channel) =>
      reprocessDeadLetters(
        channel,
        topology,
        (s) => s.eventId === randomUUID(),
      ),
    );
    assert.deepEqual(done, []);
    assert.equal(await depth(topology.deadLetterQueue), 1);
    assert.equal(await depth(topology.queue), 0);
  });

  test("ERP down -> DLQ -> ERP back -> reprocess: exported once with full traceability", async () => {
    const topology = await newTopology();
    const sales = new Map();
    const erp = {
      down: true,
      async postSale(sale, key) {
        if (this.down) throw new ErpUnavailableError("ERP timeout");
        if (!sales.has(key)) sales.set(key, `ERP-${sales.size + 1}`);
        return { externalId: sales.get(key) };
      },
      async getInventory() {
        return { items: [] };
      },
    };
    const consumer = new ErpSalesConsumer(
      process.env.RABBITMQ_URL,
      topology,
      new ExportSaleUseCase(
        new ErpSaleExportRepository(pool),
        erp,
        topology.maxDeliveryAttempts,
      ),
      () => undefined,
    );
    await consumer.start();
    consumers.push(consumer);
    const event = saleEvent();
    await withChannel(
      (channel) =>
        new Promise((done, fail) =>
          channel.publish(
            topology.exchange,
            topology.routingKey,
            Buffer.from(JSON.stringify(event)),
            {
              persistent: true,
              messageId: event.eventId,
              correlationId: event.correlationId,
            },
            (error) => (error ? fail(error) : done()),
          ),
        ),
    );
    await waitFor(async () => (await depth(topology.deadLetterQueue)) === 1);
    const failed = (
      await pool.query(`SELECT * FROM "ErpSaleExport" WHERE "eventId" = $1`, [
        event.eventId,
      ])
    ).rows[0];
    assert.equal(failed.status, "failed");
    assert.equal(failed.attempts, 2);

    erp.down = false;
    const done = await withChannel((channel) =>
      reprocessDeadLetters(channel, topology, () => true),
    );
    assert.equal(done.length, 1);
    const exported = await waitFor(async () => {
      const row = (
        await pool.query(`SELECT * FROM "ErpSaleExport" WHERE "eventId" = $1`, [
          event.eventId,
        ])
      ).rows[0];
      return row.status === "exported" ? row : null;
    });
    assert.equal(exported.attempts, 3, "the attempt history is kept");
    assert.equal(exported.erpReference, "ERP-1");
    assert.equal(sales.size, 1);
    assert.equal(await depth(topology.deadLetterQueue), 0);
  });
});
