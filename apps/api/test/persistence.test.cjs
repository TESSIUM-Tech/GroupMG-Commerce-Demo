const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
if (process.env.ALLOW_DB_TESTS !== "true")
  throw new Error("Use ALLOW_DB_TESTS=true only in an isolated test database");
if (
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
)
  throw new Error("Tests require commerce_issue2_test database");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
after(() => db.$disconnect());
const rollback = new Error("ROLLBACK_TEST");
async function isolated(fn) {
  try {
    await db.$transaction(async (tx) => {
      await fn(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
async function rejectsConstraint(fn, expected) {
  await assert.rejects(isolated(fn), (error) => {
    const originalCode =
      error.meta?.originalCode ??
      error.meta?.driverAdapterError?.cause?.originalCode;
    const checkViolation =
      expected.includes("P2004") &&
      error.code === "P2039" &&
      originalCode === "23514";
    assert.ok(
      expected.includes(error.code) || checkViolation,
      `Unexpected database failure: ${error.code}; SQLSTATE=${originalCode}; metadata=${JSON.stringify(error.meta)}`,
    );
    return true;
  });
}
async function fixture(tx) {
  const customer = await tx.guestCustomer.create({
    data: {
      firstName: "Demo",
      lastName: "Test",
      email: "demo@example.invalid",
      phone: "0000000000",
    },
  });
  const product = await tx.product.findUniqueOrThrow({
    where: { sku: "MG-DEMO-001" },
  });
  const order = await tx.order.create({
    data: {
      customerId: customer.id,
      currency: "USD",
      subtotalMinor: 450,
      taxMinor: 68,
      totalMinor: 518,
      fulfillment: "pickup",
      customerSnapshot: { name: "Demo Test" },
      billingIdentificationType: "passport",
      billingIdentification: "DEMO-NOT-VALID",
      billingName: "Demo Test",
      billingAddress: { city: "Demo" },
      billingEmail: "demo@example.invalid",
      idempotencyKey: randomUUID(),
      requestHash: "a".repeat(64),
      accessTokenHash:
        randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
      accessTokenExpiresAt: new Date(Date.now() + 86400000),
      reservationExpiresAt: new Date(Date.now() + 300000),
    },
  });
  return { customer, product, order };
}
function runSeed() {
  const result = spawnSync(
    process.execPath,
    [resolve(__dirname, "../prisma/seed.cjs")],
    { env: process.env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, "Seed failed (credentials omitted)");
}

test("seed repeated preserves IDs, counts, reserved and consumed inventory", async () => {
  runSeed();
  const before = await db.product.findMany({
    orderBy: { sku: "asc" },
    select: { id: true, sku: true },
  });
  assert.equal(before.length, 12);
  const product = await db.product.findUniqueOrThrow({
    where: { sku: "MG-DEMO-001" },
  });
  const initial = await db.inventory.findUniqueOrThrow({
    where: { productId: product.id },
  });
  try {
    await db.inventory.update({
      where: { productId: product.id },
      data: { onHand: 18, reserved: 2 },
    });
    runSeed();
    runSeed();
    assert.deepEqual(
      await db.product.findMany({
        orderBy: { sku: "asc" },
        select: { id: true, sku: true },
      }),
      before,
    );
    assert.equal(
      await db.category.count({
        where: {
          products: { some: { sku: { in: before.map((p) => p.sku) } } },
        },
      }),
      4,
    );
    assert.equal(await db.inventory.count(), 12);
    const actual = await db.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    assert.equal(actual.onHand, 18);
    assert.equal(actual.reserved, 2);
    const soldOut = await db.product.findUniqueOrThrow({
      where: { sku: "MG-DEMO-012" },
      include: { inventory: true },
    });
    assert.equal(soldOut.inventory.onHand, 0);
  } finally {
    await db.inventory.update({
      where: { productId: product.id },
      data: { onHand: initial.onHand, reserved: initial.reserved },
    });
  }
});

test("database rejects negative price, over-reservation and duplicate supplier reference", async () => {
  await rejectsConstraint(
    async (tx) => {
      await tx.product.update({
        where: { sku: "MG-DEMO-001" },
        data: { priceMinor: -1 },
      });
    },
    ["P2004"],
  );
  await rejectsConstraint(
    async (tx) => {
      const p = await tx.product.findUniqueOrThrow({
        where: { sku: "MG-DEMO-001" },
      });
      await tx.inventory.update({
        where: { productId: p.id },
        data: { reserved: 999 },
      });
    },
    ["P2004"],
  );
  await rejectsConstraint(
    async (tx) => {
      await tx.product.update({
        where: { sku: "MG-DEMO-002" },
        data: { supplierReference: "ERP-DEMO-001" },
      });
    },
    ["P2002"],
  );
});

test("orders reject incorrect totals, missing customer, invalid state and reused idempotency key", async () => {
  await rejectsConstraint(
    async (tx) => {
      const { order } = await fixture(tx);
      await tx.order.update({
        where: { id: order.id },
        data: { totalMinor: 1 },
      });
    },
    ["P2004"],
  );
  await rejectsConstraint(
    async (tx) => {
      const { order } = await fixture(tx);
      await tx.order.update({
        where: { id: order.id },
        data: { customerId: randomUUID() },
      });
    },
    ["P2003"],
  );
  await rejectsConstraint(
    async (tx) => {
      const { order } = await fixture(tx);
      await tx.$executeRaw`UPDATE "Order" SET status = 'invalid_state' WHERE id = ${order.id}::uuid`;
    },
    ["P2010"],
  );
  await rejectsConstraint(
    async (tx) => {
      const first = await fixture(tx);
      const second = await fixture(tx);
      await tx.order.update({
        where: { id: second.order.id },
        data: { idempotencyKey: first.order.idempotencyKey },
      });
    },
    ["P2002"],
  );
});

test("items reject zero quantity and mismatched order currency", async () => {
  await rejectsConstraint(
    async (tx) => {
      const { order, product } = await fixture(tx);
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          currency: "USD",
          productId: product.id,
          sku: product.sku,
          supplierReference: product.supplierReference,
          productName: product.name,
          quantity: 0,
          unitPriceMinor: 450,
          taxRateBps: 1500,
          taxMinor: 0,
          totalMinor: 0,
        },
      });
    },
    ["P2004"],
  );
  await rejectsConstraint(
    async (tx) => {
      const { order, product } = await fixture(tx);
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          currency: "EUR",
          productId: product.id,
          sku: product.sku,
          supplierReference: product.supplierReference,
          productName: product.name,
          quantity: 1,
          unitPriceMinor: 450,
          taxRateBps: 1500,
          taxMinor: 68,
          totalMinor: 518,
        },
      });
    },
    ["P2003", "P2004"],
  );
});

test("payment/receipt/outbox support atomic write and reject duplicates", async () => {
  await isolated(async (tx) => {
    const { order, product } = await fixture(tx);
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        currency: "USD",
        productId: product.id,
        sku: product.sku,
        supplierReference: product.supplierReference,
        productName: product.name,
        quantity: 1,
        unitPriceMinor: 450,
        taxRateBps: 1500,
        taxMinor: 68,
        totalMinor: 518,
      },
    });
    await tx.stockReservation.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        expiresAt: order.reservationExpiresAt,
      },
    });
    await tx.payment.create({
      data: {
        orderId: order.id,
        currency: "USD",
        clientTransactionId: randomUUID(),
        providerTransactionId: randomUUID(),
        amountMinor: 518,
        status: "approved",
        verifiedAt: new Date(),
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: "confirmed" },
    });
    await tx.outboxEvent.create({
      data: {
        orderId: order.id,
        payload: { type: "order.confirmed.v1", orderId: order.id },
      },
    });
    assert.equal(
      await tx.outboxEvent.count({ where: { orderId: order.id } }),
      1,
    );
  });
  await rejectsConstraint(
    async (tx) => {
      const { order } = await fixture(tx);
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          currency: "USD",
          clientTransactionId: randomUUID(),
          amountMinor: 518,
        },
      });
      const receipt = {
        provider: "payphone",
        eventKey: "demo-event",
        paymentId: payment.id,
        payloadHash: "a".repeat(64),
      };
      await tx.webhookReceipt.create({ data: receipt });
      await tx.webhookReceipt.create({ data: receipt });
    },
    ["P2002"],
  );
  await rejectsConstraint(
    async (tx) => {
      const { order } = await fixture(tx);
      await tx.outboxEvent.create({ data: { orderId: order.id, payload: {} } });
      await tx.outboxEvent.create({ data: { orderId: order.id, payload: {} } });
    },
    ["P2002"],
  );
  await rejectsConstraint(
    async (tx) => {
      const { order } = await fixture(tx);
      await tx.payment.create({
        data: {
          orderId: order.id,
          currency: "USD",
          clientTransactionId: randomUUID(),
          amountMinor: 518,
          status: "approved",
        },
      });
    },
    ["P2004"],
  );
});

test("NestJS connects to PostgreSQL and closes its connection on shutdown", async () => {
  require("reflect-metadata");
  const { NestFactory } = require("@nestjs/core");
  const { AppModule } = require("../dist/app.module");
  const { PrismaService } = require("../dist/database/prisma.service");
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.init();
    const result = await app.get(PrismaService)
      .$queryRaw`SELECT 1 AS connected`;
    assert.equal(result[0].connected, 1);
  } finally {
    await app.close();
  }
});
