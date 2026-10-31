const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
const RABBITMQ_URL = process.env.RABBITMQ_URL;
// The app's own relay stays off; this file drives OutboxPublisher directly.
delete process.env.RABBITMQ_URL;
require("reflect-metadata");
const amqp = require("amqplib");
const { NestFactory } = require("@nestjs/core");
const { ValidationPipe } = require("@nestjs/common");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/database/prisma.service");
const {
  HttpExceptionFilter,
} = require("../dist/common/filters/http-exception.filter");
const { OutboxPublisher } = require("../dist/messaging/outbox-publisher");
const {
  RabbitMqPublisherChannel,
} = require("../dist/messaging/rabbitmq-publisher-channel");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  process.env.ALLOW_RABBITMQ_TESTS !== "true" ||
  !RABBITMQ_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Outbox tests require commerce_issue2_test, a local RabbitMQ and ALLOW_DB_TESTS/ALLOW_RABBITMQ_TESTS=true",
  );
}

describe("Outbox relay to RabbitMQ", () => {
  let app, prisma, api, admin, adminChannel;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const categoryId = randomUUID();
  const product = { id: randomUUID(), sku: `T12-${tag}-A` };
  const topologies = [];

  before(async () => {
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
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
    api = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    prisma = app.get(PrismaService);
    admin = await amqp.connect(RABBITMQ_URL);
    adminChannel = await admin.createChannel();
    await prisma.category.create({
      data: {
        id: categoryId,
        slug: `t12-${tag.toLowerCase()}`,
        name: "Outbox test",
      },
    });
    await prisma.product.create({
      data: {
        id: product.id,
        sku: product.sku,
        supplierReference: product.sku,
        name: "Outbox test product",
        categoryId,
        priceMinor: 1000,
        currency: "USD",
        taxRateBps: 1500,
        imageUrl: "/demo/products/MG-DEMO-001.svg",
        imageLicense: "test",
        published: true,
        inventory: { create: { onHand: 500 } },
      },
    });
  });

  after(async () => {
    try {
      for (const t of topologies) {
        for (const queue of [t.queue, t.retryQueue, t.deadLetterQueue]) {
          await adminChannel.deleteQueue(queue);
        }
        await adminChannel.deleteExchange(t.exchange);
      }
      await adminChannel.close();
      await admin.close();
      if (prisma)
        await prisma.$transaction(async (tx) => {
          const orders = await tx.order.findMany({
            where: { items: { some: { productId: product.id } } },
            select: { id: true, customerId: true },
          });
          const orderIds = orders.map((o) => o.id);
          await tx.outboxEvent.deleteMany({
            where: { orderId: { in: orderIds } },
          });
          await tx.stockReservation.deleteMany({
            where: { orderId: { in: orderIds } },
          });
          await tx.orderItem.deleteMany({
            where: { orderId: { in: orderIds } },
          });
          await tx.order.deleteMany({ where: { id: { in: orderIds } } });
          await tx.guestCustomer.deleteMany({
            where: { id: { in: orders.map((o) => o.customerId) } },
          });
          await tx.inventory.deleteMany({ where: { productId: product.id } });
          await tx.product.deleteMany({ where: { id: product.id } });
          await tx.category.deleteMany({ where: { id: categoryId } });
        });
    } finally {
      if (app) await app.close();
    }
  });

  function newTopology(routingKey = "order.confirmed.v1") {
    const suffix = randomUUID().slice(0, 8);
    const topology = {
      exchange: `test.outbox.${suffix}`,
      routingKey,
      queue: `test.outbox.${suffix}.sales`,
      retryQueue: `test.outbox.${suffix}.retry`,
      deadLetterQueue: `test.outbox.${suffix}.dlq`,
      retryDelayMs: 300,
      maxDeliveryAttempts: 3,
    };
    topologies.push(topology);
    return topology;
  }

  /** Creates a real order and its order.confirmed.v1 outbox event. */
  async function confirmedSale(createdAt = new Date()) {
    const response = await fetch(`${api}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        items: [{ sku: product.sku, quantity: 1 }],
        customer: {
          firstName: "Outbox",
          lastName: "Demo",
          email: "outbox@example.invalid",
          phone: "0991234567",
        },
        fulfillment: { type: "pickup" },
        billing: {
          identificationType: "cedula",
          identification: "1710034065",
          name: "Outbox Demo",
          email: "outbox@example.invalid",
          address: "Quito",
        },
      }),
    });
    assert.equal(response.status, 201);
    const { order } = await response.json();
    const eventId = randomUUID();
    const payload = {
      eventId,
      type: "order.confirmed.v1",
      occurredAt: createdAt.toISOString(),
      correlationId: `corr-${eventId}`,
      data: {
        orderId: order.id,
        currency: "USD",
        totalMinor: order.totalMinor,
        items: [{ sku: product.sku, quantity: 1, unitPriceMinor: 1000 }],
      },
    };
    await prisma.outboxEvent.create({
      data: { id: eventId, orderId: order.id, payload, createdAt },
    });
    return { eventId, payload };
  }

  async function drain(queue) {
    const messages = [];
    for (;;) {
      const message = await adminChannel.get(queue, { noAck: true });
      if (!message) return messages;
      messages.push(message);
    }
  }

  const eventRow = (id) =>
    prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

  async function relay(topology, options) {
    const channel = new RabbitMqPublisherChannel(RABBITMQ_URL, topology);
    try {
      return await new OutboxPublisher(
        prisma,
        channel,
        topology,
        options,
      ).publishPending();
    } finally {
      await channel.close();
    }
  }

  test("pending events are published oldest first and marked only after the broker confirms", async () => {
    const topology = newTopology();
    const older = await confirmedSale(new Date(Date.now() - 60_000));
    const newer = await confirmedSale();
    const summary = await relay(topology);
    assert.equal(summary.published, 2);
    assert.equal(summary.stopped, false);
    const messages = await drain(topology.queue);
    assert.deepEqual(
      messages.map((m) => m.properties.messageId),
      [older.eventId, newer.eventId],
    );
    const [first] = messages;
    assert.equal(first.properties.deliveryMode, 2, "persistent");
    assert.equal(first.properties.type, "order.confirmed.v1");
    assert.equal(first.properties.contentType, "application/json");
    assert.equal(first.properties.correlationId, older.payload.correlationId);
    assert.deepEqual(JSON.parse(first.content.toString()), older.payload);
    for (const { eventId } of [older, newer]) {
      const row = await eventRow(eventId);
      assert.equal(row.status, "published");
      assert.ok(row.publishedAt);
    }
  });

  test("with the broker down nothing is lost: the event stays pending", async () => {
    const topology = newTopology();
    const sale = await confirmedSale();
    const down = new URL(RABBITMQ_URL);
    down.port = "5679";
    const channel = new RabbitMqPublisherChannel(down.toString(), topology);
    const summary = await new OutboxPublisher(
      prisma,
      channel,
      topology,
    ).publishPending();
    await channel.close();
    assert.equal(summary.stopped, true);
    assert.equal(summary.published, 0);
    let row = await eventRow(sale.eventId);
    assert.equal(row.status, "pending");
    assert.equal(row.publishedAt, null);
    assert.equal(row.attempts, 1);
    // Broker back: the same event goes out.
    assert.equal((await relay(topology)).published, 1);
    row = await eventRow(sale.eventId);
    assert.equal(row.status, "published");
    assert.equal((await drain(topology.queue)).length, 1);
  });

  test("a crash between publish and mark republishes the same eventId (at least once)", async () => {
    const topology = newTopology();
    const sale = await confirmedSale();
    await assert.rejects(
      relay(topology, {
        afterConfirm: async () => {
          throw new Error("simulated crash after the broker confirm");
        },
      }),
      /simulated crash/,
    );
    assert.equal((await eventRow(sale.eventId)).status, "pending");
    assert.equal((await relay(topology)).published, 1);
    const copies = await drain(topology.queue);
    assert.deepEqual(
      copies.map((m) => m.properties.messageId),
      [sale.eventId, sale.eventId],
      "the consumer must deduplicate by eventId",
    );
    assert.equal((await eventRow(sale.eventId)).status, "published");
  });

  test("a message without a route is not marked published", async () => {
    const topology = newTopology("some.other.event");
    const sale = await confirmedSale();
    const summary = await relay(topology);
    assert.equal(summary.published, 0);
    assert.equal(summary.stopped, true);
    const row = await eventRow(sale.eventId);
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 1);
    await prisma.outboxEvent.update({
      where: { id: sale.eventId },
      data: { status: "failed" },
    });
  });

  test("two relays at once publish each event exactly once", async () => {
    const topology = newTopology();
    const sales = [];
    for (let i = 0; i < 6; i += 1) sales.push(await confirmedSale());
    const [a, b] = await Promise.all([relay(topology), relay(topology)]);
    assert.equal(a.published + b.published, sales.length);
    const ids = (await drain(topology.queue)).map(
      (m) => m.properties.messageId,
    );
    assert.equal(ids.length, sales.length);
    assert.equal(new Set(ids).size, sales.length);
  });
});
