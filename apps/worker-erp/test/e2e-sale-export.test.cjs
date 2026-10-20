const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
const RABBITMQ_URL = process.env.RABBITMQ_URL;
// The API runs in this process with a simulated payment provider; its own
// outbox relay stays off so the test drives each step explicitly.
delete process.env.RABBITMQ_URL;
const SECRET = "e".repeat(40);
process.env.PAYMENTS_MODE = "simulated";
process.env.PAYMENTS_SIMULATED_OUTCOME = "approved";
process.env.PAYMENTS_CALLBACK_SECRET = SECRET;
require("reflect-metadata");
const amqp = require("amqplib");
const { Pool } = require("pg");
const api = (path) => require(`../../api/dist/${path}`);
const { NestFactory } = require("@nestjs/core");
const { ValidationPipe } = require("@nestjs/common");
const { AppModule } = api("app.module");
const { PrismaService } = api("database/prisma.service");
const { HttpExceptionFilter } = api("common/filters/http-exception.filter");
const { OutboxPublisher } = api("messaging/outbox-publisher");
const { RabbitMqPublisherChannel } = api(
  "messaging/rabbitmq-publisher-channel",
);
const { signCallback, CALLBACK_PATH } = api(
  "modules/payments/application/callback-signature",
);
const { ErpSalesConsumer } = require("../dist/messaging/erp-sales.consumer");
const {
  ErpSaleExportRepository,
} = require("../dist/exports/erp-sale-export.repository");
const { ExportSaleUseCase } = require("../dist/exports/export-sale.use-case");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  process.env.ALLOW_RABBITMQ_TESTS !== "true" ||
  !RABBITMQ_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "E2E tests require commerce_issue2_test, a local RabbitMQ and ALLOW_DB_TESTS/ALLOW_RABBITMQ_TESTS=true",
  );
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await sleep(200);
  }
}

describe("Confirmed sale from checkout to the ERP (DEMO-08 -> 09 -> 12)", () => {
  let app, prisma, origin, pool, consumer;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const categoryId = randomUUID();
  const product = { id: randomUUID(), sku: `T12E-${tag}-A` };
  const suffix = randomUUID().slice(0, 8);
  const topology = {
    exchange: `test.e2e.${suffix}`,
    routingKey: "order.confirmed.v1",
    queue: `test.e2e.${suffix}.sales`,
    retryQueue: `test.e2e.${suffix}.retry`,
    deadLetterQueue: `test.e2e.${suffix}.dlq`,
    retryDelayMs: 300,
    maxDeliveryAttempts: 3,
  };
  const erpSales = new Map();
  const erp = {
    async postSale(sale, key) {
      if (!erpSales.has(key))
        erpSales.set(key, { ...sale, externalId: `ERP-${erpSales.size + 1}` });
      return { externalId: erpSales.get(key).externalId };
    },
    async getInventory() {
      return { items: [] };
    },
  };

  before(async () => {
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
      rawBody: true,
    });
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, "127.0.0.1");
    origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    prisma = app.get(PrismaService);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    await prisma.category.create({
      data: {
        id: categoryId,
        slug: `t12e-${tag.toLowerCase()}`,
        name: "E2E test",
      },
    });
    await prisma.product.create({
      data: {
        id: product.id,
        sku: product.sku,
        supplierReference: product.sku,
        name: "E2E test product",
        categoryId,
        priceMinor: 1000,
        currency: "USD",
        taxRateBps: 1500,
        imageUrl: "/demo/products/MG-DEMO-001.svg",
        imageLicense: "test",
        published: true,
        inventory: { create: { onHand: 50 } },
      },
    });
    consumer = new ErpSalesConsumer(
      RABBITMQ_URL,
      topology,
      new ExportSaleUseCase(
        new ErpSaleExportRepository(pool),
        erp,
        topology.maxDeliveryAttempts,
      ),
      () => undefined,
    );
    await consumer.start();
  });

  after(async () => {
    try {
      await consumer?.stop();
      // Fresh connection: one opened earlier may have been closed by a restart.
      const admin = await amqp.connect(RABBITMQ_URL);
      const channel = await admin.createChannel();
      for (const queue of [
        topology.queue,
        topology.retryQueue,
        topology.deadLetterQueue,
      ]) {
        await channel.deleteQueue(queue);
      }
      await channel.deleteExchange(topology.exchange);
      await admin.close();
      const orders = await prisma.order.findMany({
        where: { items: { some: { productId: product.id } } },
        select: { id: true, customerId: true },
      });
      const orderIds = orders.map((o) => o.id);
      await pool.query(
        `DELETE FROM "ErpSaleExport" WHERE "orderId" = ANY($1::uuid[])`,
        [orderIds],
      );
      await pool.end();
      await prisma.$transaction(async (tx) => {
        const payments = await tx.payment.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        });
        await tx.webhookReceipt.deleteMany({
          where: { paymentId: { in: payments.map((p) => p.id) } },
        });
        await tx.outboxEvent.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
        await tx.stockReservation.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        await tx.order.deleteMany({ where: { id: { in: orderIds } } });
        await tx.guestCustomer.deleteMany({
          where: { id: { in: orders.map((o) => o.customerId) } },
        });
        await tx.inventory.deleteMany({ where: { productId: product.id } });
        await tx.product.deleteMany({ where: { id: product.id } });
        await tx.category.deleteMany({ where: { id: categoryId } });
      });
    } finally {
      await app?.close();
    }
  });

  /** Checkout over HTTP: order, simulated PayPhone payment and signed callback. */
  async function confirmedOrder() {
    const created = await fetch(`${origin}/api/v1/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        items: [{ sku: product.sku, quantity: 2 }],
        customer: {
          firstName: "E2E",
          lastName: "Demo",
          email: "e2e@example.invalid",
          phone: "0991234567",
        },
        fulfillment: { type: "pickup" },
        billing: {
          identificationType: "cedula",
          identification: "1710034065",
          name: "E2E Demo",
          email: "e2e@example.invalid",
          address: "Quito",
        },
      }),
    });
    assert.equal(created.status, 201);
    const { order, accessToken } = await created.json();
    const started = await fetch(
      `${origin}/api/v1/orders/${order.id}/payments`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(started.status, 201);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const query = new URLSearchParams({
      id: payment.providerTransactionId,
      clientTransactionID: payment.clientTransactionId,
    });
    const callback = await fetch(
      `${origin}${CALLBACK_PATH}/${signCallback(SECRET, payment.clientTransactionId)}?${query}`,
    );
    assert.equal(callback.status, 200);
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { orderId: order.id },
    });
    return { order, event };
  }

  async function relay(url = RABBITMQ_URL) {
    const channel = new RabbitMqPublisherChannel(url, topology);
    try {
      return await new OutboxPublisher(
        prisma,
        channel,
        topology,
      ).publishPending();
    } finally {
      await channel.close();
    }
  }

  async function exportOf(orderId) {
    const { rows } = await pool.query(
      `SELECT * FROM "ErpSaleExport" WHERE "orderId" = $1`,
      [orderId],
    );
    return rows[0]?.status === "exported" ? rows[0] : null;
  }

  test("a paid order reaches the ERP exactly once, with the same eventId end to end", async () => {
    const { order, event } = await confirmedOrder();
    assert.equal(event.status, "pending");
    assert.equal((await relay()).published, 1);
    const exported = await waitFor(() => exportOf(order.id));
    assert.equal(exported.eventId, event.id);
    const sale = erpSales.get(event.id);
    assert.deepEqual(sale, {
      orderId: order.id,
      currency: "USD",
      totalMinor: order.totalMinor,
      externalId: exported.erpReference,
    });
    const published = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    assert.equal(published.status, "published");
    // Republishing the same event (crash before marking) still makes one sale.
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: "pending", publishedAt: null },
    });
    assert.equal((await relay()).published, 1);
    await sleep(800);
    assert.equal(
      [...erpSales.values()].filter((s) => s.orderId === order.id).length,
      1,
    );
  });

  test(
    "a RabbitMQ restart loses nothing: the outbox waits and the worker reconnects",
    {
      skip:
        process.env.ALLOW_BROKER_RESTART_TESTS !== "true" &&
        "set ALLOW_BROKER_RESTART_TESTS=true (restarts the rabbitmq container)",
    },
    async () => {
      const repoRoot = resolve(__dirname, "../../..");
      execFileSync("docker", ["compose", "stop", "rabbitmq"], {
        cwd: repoRoot,
        stdio: "pipe",
      });
      try {
        const { order, event } = await confirmedOrder();
        const down = await relay();
        assert.equal(down.stopped, true, "broker down: nothing published");
        assert.equal(
          (
            await prisma.outboxEvent.findUniqueOrThrow({
              where: { id: event.id },
            })
          ).status,
          "pending",
        );
        execFileSync("docker", ["compose", "up", "-d", "--wait", "rabbitmq"], {
          cwd: repoRoot,
          stdio: "pipe",
        });
        await waitFor(async () => (await relay()).published === 1, 30_000);
        const exported = await waitFor(() => exportOf(order.id), 30_000);
        assert.equal(exported.eventId, event.id);
      } finally {
        execFileSync("docker", ["compose", "up", "-d", "--wait", "rabbitmq"], {
          cwd: repoRoot,
          stdio: "pipe",
        });
      }
    },
  );
});
