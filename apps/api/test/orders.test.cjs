const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { ValidationPipe } = require("@nestjs/common");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/database/prisma.service");
const {
  HttpExceptionFilter,
} = require("../dist/common/filters/http-exception.filter");
const { setupSwagger } = require("../dist/documentation/swagger");
const {
  ReleaseExpiredReservationsUseCase,
} = require("../dist/modules/orders/application/release-expired-reservations.use-case");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Order tests require the isolated commerce_issue2_test database and ALLOW_DB_TESTS=true",
  );
}

describe("Orders HTTP with PostgreSQL", () => {
  let app, prisma, baseUrl, docsUrl;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const categoryId = randomUUID();
  const zone = `test-zone-${tag.toLowerCase()}`;
  const product = {
    regular: {
      id: randomUUID(),
      sku: `T08-${tag}-REG`,
      price: 1000,
      onHand: 50,
    },
    last: { id: randomUUID(), sku: `T08-${tag}-LAST`, price: 1990, onHand: 1 },
    hidden: { id: randomUUID(), sku: `T08-${tag}-HID`, price: 500, onHand: 5 },
    expiring: {
      id: randomUUID(),
      sku: `T08-${tag}-EXP`,
      price: 700,
      onHand: 4,
    },
  };
  const productIds = Object.values(product).map((p) => p.id);

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
        stopAtFirstError: false,
        validationError: { target: false, value: false },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    setupSwagger(app);
    await app.listen(0, "127.0.0.1");
    const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    baseUrl = `${origin}/api/v1/orders`;
    docsUrl = `${origin}/api/docs-json`;
    prisma = app.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      await tx.category.create({
        data: {
          id: categoryId,
          slug: `t08-${tag.toLowerCase()}`,
          name: "Orders test",
        },
      });
      for (const [key, p] of Object.entries(product)) {
        await tx.product.create({
          data: {
            id: p.id,
            sku: p.sku,
            supplierReference: p.sku,
            name: `Orders test ${key}`,
            categoryId,
            priceMinor: p.price,
            currency: "USD",
            taxRateBps: 1500,
            imageUrl: "/demo/products/MG-DEMO-001.svg",
            imageLicense: "test",
            published: key !== "hidden",
            inventory: { create: { onHand: p.onHand } },
          },
        });
      }
      await tx.shippingRate.create({
        data: {
          zone,
          version: 1,
          amountMinor: 300,
          currency: "USD",
          taxRateBps: 1500,
          validFrom: new Date(Date.now() - 86_400_000),
        },
      });
    });
  });

  after(async () => {
    try {
      if (prisma)
        await prisma.$transaction(async (tx) => {
          const orders = await tx.order.findMany({
            where: { items: { some: { productId: { in: productIds } } } },
            select: { id: true, customerId: true },
          });
          const orderIds = orders.map((o) => o.id);
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
          await tx.inventory.deleteMany({
            where: { productId: { in: productIds } },
          });
          await tx.product.deleteMany({ where: { id: { in: productIds } } });
          await tx.category.deleteMany({ where: { id: categoryId } });
          await tx.shippingRate.deleteMany({ where: { zone } });
        });
    } finally {
      if (app) await app.close();
    }
  });

  function payload(items, overrides = {}) {
    return {
      items,
      customer: {
        firstName: "Demo",
        lastName: "Invitado",
        email: "Demo.Invitado@Example.invalid",
        phone: "0990000000",
      },
      fulfillment: { type: "pickup" },
      billing: {
        identificationType: "cedula",
        identification: "1710034065",
        name: "Demo Invitado",
        email: "demo.invitado@example.invalid",
        address: "Quito",
      },
      ...overrides,
    };
  }

  async function post(body, key = randomUUID()) {
    const headers = { "content-type": "application/json" };
    if (key !== null) headers["idempotency-key"] = key;
    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  }

  async function get(id, authorization) {
    const response = await fetch(`${baseUrl}/${id}`, {
      headers: authorization ? { authorization } : {},
    });
    return { response, body: await response.json() };
  }

  async function reserved(p) {
    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { productId: p.id },
    });
    return inventory.reserved;
  }

  async function backdateReservation(orderId) {
    await prisma.$executeRaw`
      UPDATE "Order" SET "createdAt" = now() - interval '10 minutes',
        "reservationExpiresAt" = now() - interval '5 minutes'
      WHERE "id" = ${orderId}::uuid`;
    await prisma.$executeRaw`
      UPDATE "StockReservation" SET "createdAt" = now() - interval '10 minutes',
        "expiresAt" = now() - interval '5 minutes'
      WHERE "orderId" = ${orderId}::uuid`;
  }

  test("creates a pending order with totals, snapshots and reservation computed by the server", async () => {
    const before = await reserved(product.regular);
    const { response, body } = await post(
      payload([{ sku: product.regular.sku, quantity: 3 }]),
    );
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.correlationId, response.headers.get("x-correlation-id"));
    const { order, accessToken } = body;
    assert.equal(order.status, "pending_payment");
    assert.equal(order.currency, "USD");
    assert.equal(order.subtotalMinor, 3000);
    assert.equal(order.taxMinor, 450);
    assert.equal(order.shippingMinor, 0);
    assert.equal(order.totalMinor, 3450);
    assert.deepEqual(order.items, [
      {
        sku: product.regular.sku,
        productName: "Orders test regular",
        quantity: 3,
        unitPriceMinor: 1000,
        taxRateBps: 1500,
        taxMinor: 450,
        totalMinor: 3450,
      },
    ]);
    const ttl =
      new Date(order.reservationExpiresAt) - new Date(order.createdAt);
    assert.equal(ttl, 5 * 60_000);
    assert.match(accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.order.customerSnapshot, undefined);
    assert.equal(JSON.stringify(body).includes("example.invalid"), false);

    assert.equal(await reserved(product.regular), before + 3);
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { reservations: true, customer: true },
    });
    assert.equal(
      stored.accessTokenHash,
      createHash("sha256").update(accessToken).digest("hex"),
    );
    assert.notEqual(stored.accessTokenHash, accessToken);
    assert.equal(stored.customer.email, "demo.invitado@example.invalid");
    assert.equal(stored.customerSnapshot.firstName, "Demo");
    assert.equal(stored.billingIdentification, "1710034065");
    assert.equal(stored.reservations.length, 1);
    assert.equal(stored.reservations[0].status, "active");
    assert.equal(stored.reservations[0].quantity, 3);
  });

  test("rejects client-supplied totals and prices (manipulated total)", async () => {
    const key = randomUUID();
    const before = await reserved(product.regular);
    for (const body of [
      {
        ...payload([{ sku: product.regular.sku, quantity: 1 }]),
        totalMinor: 1,
      },
      {
        ...payload([{ sku: product.regular.sku, quantity: 1 }]),
        subtotalMinor: 1,
        taxMinor: 0,
      },
      payload([{ sku: product.regular.sku, quantity: 1, unitPriceMinor: 1 }]),
      {
        ...payload([{ sku: product.regular.sku, quantity: 1 }]),
        status: "confirmed",
      },
    ]) {
      const result = await post(body, key);
      assert.equal(result.response.status, 400);
      assert.ok(result.body.correlationId);
      assert.equal(result.body.stack, undefined);
    }
    assert.equal(
      await prisma.order.count({ where: { idempotencyKey: key } }),
      0,
    );
    assert.equal(await reserved(product.regular), before);
  });

  test("two concurrent purchases of the last unit: exactly one reserves it", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        post(payload([{ sku: product.last.sku, quantity: 1 }])),
      ),
    );
    const statuses = attempts.map((a) => a.response.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
    const conflict = attempts.find((a) => a.response.status === 409);
    assert.deepEqual(conflict.body.skus, [product.last.sku]);
    assert.equal(await reserved(product.last), 1);
    const orders = await prisma.order.count({
      where: { items: { some: { productId: product.last.id } } },
    });
    assert.equal(orders, 1);
  });

  test("same idempotency key and payload returns the same order once, with a fresh token", async () => {
    const key = randomUUID();
    const body = payload([{ sku: product.regular.sku, quantity: 2 }]);
    const first = await post(body, key);
    assert.equal(first.response.status, 201);
    const afterFirst = await reserved(product.regular);

    // Same content, different JSON key order.
    const reordered = {
      billing: body.billing,
      fulfillment: body.fulfillment,
      customer: body.customer,
      items: [{ quantity: 2, sku: product.regular.sku }],
    };
    const replay = await post(reordered, key);
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.order.id, first.body.order.id);
    assert.deepEqual(replay.body.order, first.body.order);
    assert.notEqual(replay.body.accessToken, first.body.accessToken);
    assert.equal(await reserved(product.regular), afterFirst);
    assert.equal(
      await prisma.order.count({ where: { idempotencyKey: key } }),
      1,
    );

    const old = await get(
      first.body.order.id,
      `Bearer ${first.body.accessToken}`,
    );
    assert.equal(old.response.status, 404);
    const fresh = await get(
      first.body.order.id,
      `Bearer ${replay.body.accessToken}`,
    );
    assert.equal(fresh.response.status, 200);
  });

  test("concurrent requests with the same key create a single order", async () => {
    const key = randomUUID();
    const body = payload([{ sku: product.regular.sku, quantity: 1 }]);
    const before = await reserved(product.regular);
    const results = await Promise.all([
      post(body, key),
      post(body, key),
      post(body, key),
    ]);
    assert.deepEqual(
      results.map((r) => r.response.status).sort(),
      [200, 200, 201],
    );
    assert.equal(new Set(results.map((r) => r.body.order.id)).size, 1);
    assert.equal(
      await prisma.order.count({ where: { idempotencyKey: key } }),
      1,
    );
    assert.equal(await reserved(product.regular), before + 1);
  });

  test("same idempotency key with a different payload is rejected without side effects", async () => {
    const key = randomUUID();
    const first = await post(
      payload([{ sku: product.regular.sku, quantity: 1 }]),
      key,
    );
    assert.equal(first.response.status, 201);
    const before = await reserved(product.regular);
    const second = await post(
      payload([{ sku: product.regular.sku, quantity: 4 }]),
      key,
    );
    assert.equal(second.response.status, 422);
    assert.match(second.body.message, /Idempotency key/);
    assert.equal(
      await prisma.order.count({ where: { idempotencyKey: key } }),
      1,
    );
    assert.equal(await reserved(product.regular), before);
    const still = await get(
      first.body.order.id,
      `Bearer ${first.body.accessToken}`,
    );
    assert.equal(still.response.status, 200);
  });

  test("guest order lookup requires its opaque token and hides whether an id exists", async () => {
    const a = await post(payload([{ sku: product.regular.sku, quantity: 1 }]));
    const b = await post(payload([{ sku: product.regular.sku, quantity: 1 }]));
    const ok = await get(a.body.order.id, `Bearer ${a.body.accessToken}`);
    assert.equal(ok.response.status, 200);
    assert.equal(ok.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(ok.body.order, a.body.order);

    const wrongToken = await get(
      a.body.order.id,
      `Bearer ${b.body.accessToken}`,
    );
    const unknownId = await get(randomUUID(), `Bearer ${a.body.accessToken}`);
    for (const result of [wrongToken, unknownId]) {
      assert.equal(result.response.status, 404);
      assert.equal(result.body.message, "Order not found");
    }
    for (const auth of [undefined, "Bearer short", a.body.accessToken]) {
      const result = await get(a.body.order.id, auth);
      assert.equal(result.response.status, 401);
    }
    assert.equal(
      (await get("not-a-uuid", `Bearer ${a.body.accessToken}`)).response.status,
      400,
    );

    await prisma.$executeRaw`
      UPDATE "Order" SET "createdAt" = now() - interval '2 days',
        "reservationExpiresAt" = now() - interval '2 days' + interval '5 minutes',
        "accessTokenExpiresAt" = now() - interval '1 minute'
      WHERE "id" = ${a.body.order.id}::uuid`;
    const expired = await get(a.body.order.id, `Bearer ${a.body.accessToken}`);
    assert.equal(expired.response.status, 404);
  });

  test("unpublished, unknown and insufficient products are rejected before reserving", async () => {
    const before = await reserved(product.regular);
    const unavailable = await post(
      payload([
        { sku: product.regular.sku, quantity: 1 },
        { sku: product.hidden.sku, quantity: 1 },
        { sku: `T08-${tag}-NOPE`, quantity: 1 },
      ]),
    );
    assert.equal(unavailable.response.status, 422);
    assert.deepEqual(
      unavailable.body.skus.sort(),
      [product.hidden.sku, `T08-${tag}-NOPE`].sort(),
    );
    const tooMany = await post(
      payload([
        { sku: product.regular.sku, quantity: 1 },
        { sku: product.expiring.sku, quantity: 5 },
      ]),
    );
    assert.equal(tooMany.response.status, 409);
    assert.deepEqual(tooMany.body.skus, [product.expiring.sku]);
    assert.equal(await reserved(product.regular), before);
    assert.equal(await reserved(product.hidden), 0);
  });

  test("courier uses the current zone rate; zones without a rate and malformed requests are rejected", async () => {
    const address = {
      province: "Pichincha",
      city: "Quito",
      zone,
      address: "Av. Demo 123",
      reference: "Casa azul",
    };
    const courier = await post(
      payload([{ sku: product.regular.sku, quantity: 1 }], {
        fulfillment: { type: "courier", shippingAddress: address },
      }),
    );
    assert.equal(courier.response.status, 201);
    assert.equal(courier.body.order.fulfillment, "courier");
    assert.equal(courier.body.order.shippingMinor, 300);
    assert.equal(courier.body.order.shippingTaxMinor, 45);
    assert.equal(courier.body.order.totalMinor, 1000 + 150 + 300 + 45);
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: courier.body.order.id },
    });
    assert.equal(stored.shippingZone, zone);
    assert.equal(stored.shippingRateVersion, 1);
    assert.equal(stored.shippingAddress.city, "Quito");

    const noRate = await post(
      payload([{ sku: product.regular.sku, quantity: 1 }], {
        fulfillment: {
          type: "courier",
          shippingAddress: { ...address, zone: "no-rate-zone" },
        },
      }),
    );
    assert.equal(noRate.response.status, 422);

    for (const body of [
      payload([{ sku: product.regular.sku, quantity: 1 }], {
        fulfillment: { type: "courier" },
      }),
      payload([{ sku: product.regular.sku, quantity: 1 }], {
        fulfillment: { type: "pickup", shippingAddress: address },
      }),
      payload([{ sku: product.regular.sku, quantity: 0 }]),
      payload([]),
      payload([{ sku: product.regular.sku, quantity: 1 }], {
        billing: { ...payload([]).billing, identification: "12345" },
      }),
    ]) {
      assert.equal((await post(body)).response.status, 400);
    }
    const missingKey = await post(
      payload([{ sku: product.regular.sku, quantity: 1 }]),
      null,
    );
    assert.equal(missingKey.response.status, 400);
    assert.match(String(missingKey.body.message), /Idempotency-Key/);
  });

  test("expired reservations are released once, freeing stock for new orders", async () => {
    // Lazy release: the last unit is held by an order whose reservation expired.
    const holder = await prisma.order.findFirstOrThrow({
      where: { items: { some: { productId: product.last.id } } },
    });
    await backdateReservation(holder.id);
    const next = await post(payload([{ sku: product.last.sku, quantity: 1 }]));
    assert.equal(next.response.status, 201);
    assert.equal(await reserved(product.last), 1);
    const releasedHolder = await prisma.order.findUniqueOrThrow({
      where: { id: holder.id },
      include: { reservations: true },
    });
    assert.equal(releasedHolder.status, "expired");
    assert.equal(releasedHolder.reservations[0].status, "released");

    // Sweep: periodic release without any new purchase.
    const order = await post(
      payload([{ sku: product.expiring.sku, quantity: 3 }]),
    );
    assert.equal(order.response.status, 201);
    assert.equal(await reserved(product.expiring), 3);
    await backdateReservation(order.body.order.id);
    const release = app.get(ReleaseExpiredReservationsUseCase);
    const first = await release.execute();
    assert.ok(first.reservations >= 1);
    assert.ok(first.orders >= 1);
    assert.equal(await reserved(product.expiring), 0);
    const expired = await get(
      order.body.order.id,
      `Bearer ${order.body.accessToken}`,
    );
    assert.equal(expired.body.order.status, "expired");

    const second = await release.execute();
    assert.equal(await reserved(product.expiring), 0);
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId: order.body.order.id },
    });
    assert.deepEqual(
      reservations.map((r) => r.status),
      ["released"],
    );
    assert.equal(second.reservations, 0);
  });

  test("Swagger documents the order endpoints without accepting amounts", async () => {
    const spec = await (await fetch(docsUrl)).json();
    const create = spec.paths["/api/v1/orders"].post;
    assert.ok(
      create.parameters.some((p) => p.name === "Idempotency-Key" && p.required),
    );
    assert.ok(
      create.responses[201] && create.responses[409] && create.responses[422],
    );
    assert.ok(spec.paths["/api/v1/orders/{id}"].get.responses[404]);
    const properties = Object.keys(
      spec.components.schemas.CreateOrderDto.properties,
    );
    assert.deepEqual(properties.sort(), [
      "billing",
      "customer",
      "fulfillment",
      "items",
    ]);
  });
});
