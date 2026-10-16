const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const {
  ErpSaleExportRepository,
} = require("../dist/exports/erp-sale-export.repository");
const { ExportSaleUseCase } = require("../dist/exports/export-sale.use-case");
const {
  ErpUnavailableError,
  ErpRejectedError,
} = require("../dist/ports/erp-errors");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Worker DB tests require the isolated commerce_issue2_test database and ALLOW_DB_TESTS=true",
  );
}

const MAX_ATTEMPTS = 5;

/**
 * Fake ERP behind ErpPort. Idempotent like a real one: the same key returns
 * the same sale. `script` decides the next calls: "down" fails before
 * registering, "lost" registers the sale and then fails (lost response),
 * "reject" refuses it for good.
 */
function fakeErp() {
  const sales = new Map();
  return {
    sales,
    calls: 0,
    script: [],
    async postSale(sale, idempotencyKey) {
      this.calls += 1;
      const step = this.script.shift();
      if (step === "down") throw new ErpUnavailableError("ERP timeout");
      if (step === "reject") throw new ErpRejectedError("unknown SKU in ERP");
      if (!sales.has(idempotencyKey)) {
        sales.set(idempotencyKey, {
          ...sale,
          externalId: `ERP-${sales.size + 1}`,
        });
      }
      if (step === "lost") throw new ErpUnavailableError("response lost");
      return { externalId: sales.get(idempotencyKey).externalId };
    },
    async getInventory() {
      return { items: [] };
    },
  };
}

function saleEvent(overrides = {}) {
  const eventId = randomUUID();
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
    ...overrides,
  };
}

const message = (event, deliveryCount = 1, messageId = event.eventId) => ({
  body: Buffer.from(JSON.stringify(event)),
  messageId,
  deliveryCount,
});

describe("Export confirmed sales to the ERP", () => {
  let pool, repository;
  const eventIds = [];

  before(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    repository = new ErpSaleExportRepository(pool);
  });

  after(async () => {
    await pool.query(
      `DELETE FROM "ErpSaleExport" WHERE "eventId" = ANY($1::uuid[])`,
      [eventIds],
    );
    await pool.end();
  });

  function track(event) {
    eventIds.push(event.eventId);
    return event;
  }

  async function row(eventId) {
    const result = await pool.query(
      `SELECT * FROM "ErpSaleExport" WHERE "eventId" = $1`,
      [eventId],
    );
    return result.rows[0];
  }

  const exporter = (erp) =>
    new ExportSaleUseCase(repository, erp, MAX_ATTEMPTS);

  test("a confirmed sale is registered in the ERP with the eventId as idempotency key", async () => {
    const erp = fakeErp();
    const event = track(saleEvent());
    assert.deepEqual(await exporter(erp).execute(message(event)), {
      action: "ack",
      reason: "exported",
    });
    assert.equal(erp.calls, 1);
    assert.deepEqual(erp.sales.get(event.eventId), {
      orderId: event.data.orderId,
      currency: "USD",
      totalMinor: 3450,
      externalId: "ERP-1",
    });
    const stored = await row(event.eventId);
    assert.equal(stored.status, "exported");
    assert.equal(stored.erpReference, "ERP-1");
    assert.equal(stored.attempts, 1);
    assert.ok(stored.exportedAt);
  });

  test("redelivery of an exported event is acked without calling the ERP again", async () => {
    const erp = fakeErp();
    const event = track(saleEvent());
    await exporter(erp).execute(message(event));
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(await exporter(erp).execute(message(event, 1)), {
        action: "ack",
        reason: "duplicate",
      });
    }
    assert.equal(erp.calls, 1);
    assert.equal(erp.sales.size, 1);
  });

  test("simultaneous duplicates still produce a single ERP sale", async () => {
    const erp = fakeErp();
    const event = track(saleEvent());
    const results = await Promise.all(
      Array.from({ length: 4 }, () => exporter(erp).execute(message(event))),
    );
    assert.ok(results.every((r) => r.action === "ack"));
    assert.equal(erp.sales.size, 1, "the ERP idempotency key absorbs the race");
    assert.equal((await row(event.eventId)).status, "exported");
  });

  test("an ERP outage is retried and the next delivery exports the sale", async () => {
    const erp = fakeErp();
    erp.script = ["down"];
    const event = track(saleEvent());
    const first = await exporter(erp).execute(message(event, 1));
    assert.equal(first.action, "retry");
    let stored = await row(event.eventId);
    assert.equal(stored.status, "processing");
    assert.match(stored.lastError, /ERP timeout/);
    assert.equal(
      (await exporter(erp).execute(message(event, 2))).action,
      "ack",
    );
    stored = await row(event.eventId);
    assert.equal(stored.status, "exported");
    assert.equal(stored.attempts, 2);
    assert.equal(stored.lastError, null);
  });

  test("a lost ERP response is reconciled by the idempotency key: one sale only", async () => {
    const erp = fakeErp();
    erp.script = ["lost"];
    const event = track(saleEvent());
    assert.equal(
      (await exporter(erp).execute(message(event, 1))).action,
      "retry",
    );
    assert.equal(erp.sales.size, 1, "the ERP did register it");
    assert.equal(
      (await exporter(erp).execute(message(event, 2))).action,
      "ack",
    );
    assert.equal(erp.sales.size, 1, "the retry did not create a second sale");
    assert.equal((await row(event.eventId)).erpReference, "ERP-1");
  });

  test("after the last attempt an unavailable ERP sends the sale to the DLQ", async () => {
    const erp = fakeErp();
    erp.script = Array(MAX_ATTEMPTS).fill("down");
    const event = track(saleEvent());
    for (let delivery = 1; delivery < MAX_ATTEMPTS; delivery += 1) {
      assert.equal(
        (await exporter(erp).execute(message(event, delivery))).action,
        "retry",
      );
    }
    const last = await exporter(erp).execute(message(event, MAX_ATTEMPTS));
    assert.equal(last.action, "dead_letter");
    assert.match(last.reason, /after 5 attempts/);
    const stored = await row(event.eventId);
    assert.equal(stored.status, "failed");
    assert.equal(stored.attempts, MAX_ATTEMPTS);
  });

  test("a sale the ERP rejects for good goes to the DLQ without retries", async () => {
    const erp = fakeErp();
    erp.script = ["reject"];
    const event = track(saleEvent());
    const decision = await exporter(erp).execute(message(event, 1));
    assert.equal(decision.action, "dead_letter");
    assert.match(decision.reason, /erp_rejected/);
    assert.equal((await row(event.eventId)).status, "failed");
  });

  test("malformed or mismatched messages never reach the ERP", async () => {
    const erp = fakeErp();
    const valid = saleEvent();
    const cases = [
      [{ body: Buffer.from("not json"), deliveryCount: 1 }, /invalid_json/],
      [
        message({ ...valid, data: { ...valid.data, totalMinor: -1 } }),
        /invalid_event/,
      ],
      [message({ ...valid, type: "order.created.v1" }), /invalid_event/],
      [message(valid, 1, randomUUID()), /messageId/],
    ];
    for (const [incoming, reason] of cases) {
      const decision = await exporter(erp).execute(incoming);
      assert.equal(decision.action, "dead_letter");
      assert.match(decision.reason, reason);
    }
    assert.equal(erp.calls, 0);
    assert.equal(await row(valid.eventId), undefined);
  });

  test("a second event for an already exported order is never sold twice", async () => {
    const erp = fakeErp();
    const first = track(saleEvent());
    await exporter(erp).execute(message(first));
    const other = saleEvent({ data: first.data });
    const decision = await exporter(erp).execute(message(other));
    assert.equal(decision.action, "dead_letter");
    assert.match(decision.reason, new RegExp(first.eventId));
    assert.equal(erp.calls, 1);
  });

  test("without the database nothing is acked and the ERP is not called", async () => {
    const erp = fakeErp();
    const broken = new Pool({
      connectionString: process.env.DATABASE_URL.replace(/:\d+\//, ":5439/"),
      connectionTimeoutMillis: 1000,
    });
    try {
      await assert.rejects(
        new ExportSaleUseCase(
          new ErpSaleExportRepository(broken),
          erp,
          MAX_ATTEMPTS,
        ).execute(message(saleEvent())),
      );
      assert.equal(erp.calls, 0);
    } finally {
      await broken.end();
    }
  });
});
