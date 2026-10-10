const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
// Simulated provider for the HTTP path; never reaches PayPhone.
const SECRET = "c".repeat(40);
process.env.PAYMENTS_MODE = "simulated";
process.env.PAYMENTS_SIMULATED_OUTCOME = "approved";
process.env.PAYMENTS_CALLBACK_SECRET = SECRET;
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { ValidationPipe } = require("@nestjs/common");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/database/prisma.service");
const {
  HttpExceptionFilter,
} = require("../dist/common/filters/http-exception.filter");
const {
  PrismaPaymentsRepository,
} = require("../dist/modules/payments/infrastructure/prisma-payments.repository");
const {
  StartPaymentUseCase,
} = require("../dist/modules/payments/application/start-payment.use-case");
const {
  HandlePayPhoneCallbackUseCase,
} = require("../dist/modules/payments/application/handle-callback.use-case");
const {
  signCallback,
  CALLBACK_PATH,
} = require("../dist/modules/payments/application/callback-signature");
const {
  ProviderSaleMismatchError,
} = require("../dist/modules/payments/domain/payment-errors");
const {
  PaymentProviderUnavailableError,
} = require("../dist/modules/payments/domain/payment-provider.port");
const {
  ReleaseExpiredReservationsUseCase,
} = require("../dist/modules/orders/application/release-expired-reservations.use-case");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Payment tests require the isolated commerce_issue2_test database and ALLOW_DB_TESTS=true",
  );
}

describe("PayPhone callback and settlement with PostgreSQL", () => {
  let app, prisma, api, root;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const categoryId = randomUUID();
  const products = {
    main: { id: randomUUID(), sku: `T09C-${tag}-A`, onHand: 100 },
    scarce: { id: randomUUID(), sku: `T09C-${tag}-B`, onHand: 2 },
  };
  const productIds = Object.values(products).map((p) => p.id);
  const config = {
    mode: "payphone",
    payphone: null,
    responseBaseUrl: "https://demo.example.com",
    callbackSecret: SECRET,
    simulatedOutcome: "approved",
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
        validationError: { target: false, value: false },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, "127.0.0.1");
    root = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    api = `${root}/api/v1`;
    prisma = app.get(PrismaService);
    await prisma.category.create({
      data: {
        id: categoryId,
        slug: `t09c-${tag.toLowerCase()}`,
        name: "Callback test",
      },
    });
    for (const p of Object.values(products)) {
      await prisma.product.create({
        data: {
          id: p.id,
          sku: p.sku,
          supplierReference: p.sku,
          name: `Callback ${p.sku}`,
          categoryId,
          priceMinor: 1000,
          currency: "USD",
          taxRateBps: 1500,
          imageUrl: "/demo/products/MG-DEMO-001.svg",
          imageLicense: "test",
          published: true,
          inventory: { create: { onHand: p.onHand } },
        },
      });
    }
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
        });
    } finally {
      if (app) await app.close();
    }
  });

  async function createOrder(product = products.main, quantity = 3) {
    const response = await fetch(`${api}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        items: [{ sku: product.sku, quantity }],
        customer: {
          firstName: "Aviso",
          lastName: "Demo",
          email: "aviso@example.invalid",
          phone: "0991234567",
        },
        fulfillment: { type: "pickup" },
        billing: {
          identificationType: "cedula",
          identification: "1710034065",
          name: "Aviso Demo",
          email: "aviso@example.invalid",
          address: "Quito",
        },
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    return {
      id: body.order.id,
      token: body.accessToken,
      total: body.order.totalMinor,
    };
  }

  /** Starts a payment over HTTP (simulated provider) and returns the stored row. */
  async function startOverHttp(order) {
    const response = await fetch(`${api}/orders/${order.id}/payments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${order.token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 201);
    return prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
  }

  function callbackUrl(payment, signature) {
    const sig = signature ?? signCallback(SECRET, payment.clientTransactionId);
    const query = new URLSearchParams({
      id: payment.providerTransactionId,
      clientTransactionID: payment.clientTransactionId,
    });
    return `${root}${CALLBACK_PATH}/${sig}?${query}`;
  }

  // Provider transaction ids are unique in the database across all fakes.
  let nextTransactionId = 100_000_000 + Math.floor(Math.random() * 800_000_000);

  /** Fake PayPhone whose sales the test controls. */
  function fakePayPhone() {
    const sales = new Map();
    return {
      sales,
      unavailable: false,
      createSale: async (request) => {
        const transactionId = String(nextTransactionId++);
        sales.set(transactionId, {
          transactionId,
          clientTransactionId: request.clientTransactionId,
          status: "pending",
          amountMinor: request.amountMinor,
          currency: request.currency,
        });
        return { transactionId };
      },
      async getSale(transactionId) {
        if (this.unavailable) {
          throw new PaymentProviderUnavailableError(
            "PayPhone did not respond in time",
          );
        }
        return { ...sales.get(transactionId) };
      },
      findSaleByClientTransactionId: async () => null,
    };
  }

  function useCases(provider) {
    const repository = app.get(PrismaPaymentsRepository);
    return {
      start: new StartPaymentUseCase(repository, provider, config),
      callback: new HandlePayPhoneCallbackUseCase(repository, provider, config),
    };
  }

  async function startWithFake(provider, order) {
    await useCases(provider).start.execute(order.id, order.token);
    return prisma.payment.findFirstOrThrow({
      where: { orderId: order.id, status: "pending" },
    });
  }

  function settle(provider, payment, status) {
    provider.sales.get(payment.providerTransactionId).status = status;
    return useCases(provider).callback.execute({
      signature: signCallback(SECRET, payment.clientTransactionId),
      transactionId: payment.providerTransactionId,
      clientTransactionId: payment.clientTransactionId,
      payloadHash: "a".repeat(64),
      correlationId: `test-${status}`,
    });
  }

  async function state(order, product = products.main) {
    const [dbOrder, inventory, payments, outbox, receipts] = await Promise.all([
      prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { reservations: true },
      }),
      prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } }),
      prisma.payment.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.outboxEvent.findMany({ where: { orderId: order.id } }),
      prisma.webhookReceipt.findMany({
        where: { payment: { orderId: order.id } },
      }),
    ]);
    return { order: dbOrder, inventory, payments, outbox, receipts };
  }

  test("an invalid signature is rejected before anything is stored", async () => {
    const order = await createOrder();
    const payment = await startOverHttp(order);
    const forged = signCallback("x".repeat(40), payment.clientTransactionId);
    for (const url of [
      callbackUrl(payment, forged),
      callbackUrl(payment, "short"),
      callbackUrl(
        { ...payment, clientTransactionId: randomUUID() },
        signCallback(SECRET, payment.clientTransactionId),
      ),
    ]) {
      const response = await fetch(url);
      assert.equal(response.status, 401, url);
    }
    const after = await state(order);
    assert.equal(after.receipts.length, 0);
    assert.equal(after.order.status, "pending_payment");
    assert.equal(after.payments[0].status, "pending");
  });

  test("a verified approval confirms the order, takes the stock and writes the outbox atomically", async () => {
    const before = await prisma.inventory.findUniqueOrThrow({
      where: { productId: products.main.id },
    });
    const order = await createOrder();
    const payment = await startOverHttp(order);
    const response = await fetch(callbackUrl(payment), {
      headers: { "x-correlation-id": "callback-trace-1" },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result, "settled");
    const after = await state(order);
    assert.equal(after.order.status, "confirmed");
    assert.equal(after.payments[0].status, "approved");
    assert.ok(after.payments[0].verifiedAt);
    assert.deepEqual(
      after.order.reservations.map((r) => r.status),
      ["consumed"],
    );
    assert.equal(after.inventory.onHand, before.onHand - 3);
    assert.equal(after.inventory.reserved, before.reserved);
    assert.equal(after.receipts.length, 1);
    assert.equal(
      after.receipts[0].eventKey,
      `${payment.providerTransactionId}:approved`,
    );
    assert.match(after.receipts[0].payloadHash, /^[0-9a-f]{64}$/);
    assert.equal(after.outbox.length, 1);
    const [event] = after.outbox;
    assert.equal(event.status, "pending");
    assert.deepEqual(event.payload, {
      eventId: event.id,
      type: "order.confirmed.v1",
      occurredAt: event.payload.occurredAt,
      correlationId: "callback-trace-1",
      data: {
        orderId: order.id,
        currency: "USD",
        totalMinor: order.total,
        items: [{ sku: products.main.sku, quantity: 3, unitPriceMinor: 1000 }],
      },
    });
  });

  test("duplicate webhooks, sequential or simultaneous, are applied once", async () => {
    const before = await prisma.inventory.findUniqueOrThrow({
      where: { productId: products.main.id },
    });
    const order = await createOrder();
    const payment = await startOverHttp(order);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(callbackUrl(payment)).then((r) => r.json()),
      ),
    );
    assert.deepEqual(results.map((r) => r.result).sort(), [
      "duplicate",
      "duplicate",
      "duplicate",
      "settled",
    ]);
    const again = await fetch(callbackUrl(payment), { method: "POST" });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).result, "duplicate");
    const after = await state(order);
    assert.equal(after.receipts.length, 1);
    assert.equal(after.outbox.length, 1);
    assert.equal(after.inventory.onHand, before.onHand - 3);
    assert.equal(after.order.status, "confirmed");
  });

  test("a canceled payment cancels the order and releases the reservation once", async () => {
    const provider = fakePayPhone();
    const before = await prisma.inventory.findUniqueOrThrow({
      where: { productId: products.main.id },
    });
    const order = await createOrder();
    const payment = await startWithFake(provider, order);
    const result = await settle(provider, payment, "canceled");
    assert.equal(result.kind, "settled");
    assert.equal(result.orderStatus, "canceled");
    const after = await state(order);
    assert.equal(after.payments[0].status, "canceled");
    assert.deepEqual(
      after.order.reservations.map((r) => r.status),
      ["released"],
    );
    assert.equal(after.inventory.reserved, before.reserved);
    assert.equal(after.inventory.onHand, before.onHand);
    assert.equal(after.outbox.length, 0);
    assert.equal(
      (await settle(provider, payment, "canceled")).kind,
      "duplicate",
    );
    assert.equal(
      (
        await prisma.inventory.findUniqueOrThrow({
          where: { productId: products.main.id },
        })
      ).reserved,
      before.reserved,
    );
  });

  test("a simulated rejection is recorded as rejected, not as a bank decline", async () => {
    const provider = fakePayPhone();
    const order = await createOrder();
    const payment = await startWithFake(provider, order);
    const result = await settle(provider, payment, "rejected");
    assert.equal(result.paymentStatus, "rejected");
    assert.equal(result.orderStatus, "canceled");
  });

  test("events out of order never un-confirm or confirm twice", async () => {
    const provider = fakePayPhone();
    const order = await createOrder();
    const payment = await startWithFake(provider, order);
    await settle(provider, payment, "approved");
    const late = await settle(provider, payment, "canceled");
    assert.equal(late.kind, "settled");
    assert.equal(late.reason, "after_approval_ignored");
    const after = await state(order);
    assert.equal(after.order.status, "confirmed");
    assert.equal(after.payments[0].status, "approved");
    assert.equal(after.outbox.length, 1);
    assert.equal(after.receipts.length, 2);
  });

  test("a late approval confirms only while stock is free; otherwise review, never confirm", async () => {
    const provider = fakePayPhone();
    const release = app.get(ReleaseExpiredReservationsUseCase);
    async function expire(order) {
      await prisma.$executeRaw`
        UPDATE "Order" SET "createdAt" = now() - interval '20 minutes',
          "reservationExpiresAt" = now() - interval '10 minutes'
        WHERE "id" = ${order.id}::uuid`;
      await prisma.$executeRaw`
        UPDATE "StockReservation" SET "createdAt" = now() - interval '20 minutes',
          "expiresAt" = now() - interval '10 minutes'
        WHERE "orderId" = ${order.id}::uuid`;
      await release.execute();
    }

    // Lucky: stock still free after the reservation expired.
    const lucky = await createOrder(products.scarce, 1);
    const luckyPayment = await startWithFake(provider, lucky);
    await expire(lucky);
    assert.equal((await state(lucky, products.scarce)).order.status, "expired");
    const confirmed = await settle(provider, luckyPayment, "approved");
    assert.equal(confirmed.orderStatus, "confirmed");
    assert.equal(confirmed.reason, "late_payment_stock_available");
    let scarce = await state(lucky, products.scarce);
    assert.equal(scarce.inventory.onHand, 1);
    assert.equal(scarce.outbox.length, 1);

    // Unlucky: the last unit goes to someone else before the payment arrives.
    const unlucky = await createOrder(products.scarce, 1);
    const unluckyPayment = await startWithFake(provider, unlucky);
    await expire(unlucky);
    const other = await createOrder(products.scarce, 1);
    assert.ok(other.id);
    const review = await settle(provider, unluckyPayment, "approved");
    assert.equal(review.orderStatus, "review_required");
    assert.equal(review.paymentStatus, "review_required");
    assert.equal(review.reason, "late_payment_stock_unavailable");
    scarce = await state(unlucky, products.scarce);
    assert.equal(scarce.outbox.length, 0);
    assert.equal(
      scarce.inventory.onHand,
      1,
      "never sells stock that does not exist",
    );
    assert.equal(scarce.inventory.reserved, 1);
  });

  test("a second approved payment for a paid order is flagged as a double charge", async () => {
    const provider = fakePayPhone();
    const order = await createOrder();
    const first = await startWithFake(provider, order);
    await settle(provider, first, "approved");
    // A stray second sale for the same order (e.g. created before a crash).
    const second = await prisma.payment.create({
      data: {
        orderId: order.id,
        currency: "USD",
        clientTransactionId: randomUUID(),
        providerTransactionId: "7777777",
        amountMinor: order.total,
      },
    });
    provider.sales.set("7777777", {
      transactionId: "7777777",
      clientTransactionId: second.clientTransactionId,
      status: "approved",
      amountMinor: order.total,
      currency: "USD",
    });
    const result = await settle(provider, second, "approved");
    assert.equal(result.reason, "order_already_paid");
    assert.equal(result.paymentStatus, "review_required");
    const after = await state(order);
    assert.equal(after.order.status, "confirmed");
    assert.equal(after.outbox.length, 1);
  });

  test("a sale whose amount, client id or currency differ from ours is never settled", async () => {
    const provider = fakePayPhone();
    const order = await createOrder();
    const payment = await startWithFake(provider, order);
    const sale = provider.sales.get(payment.providerTransactionId);
    for (const [field, value] of [
      ["amountMinor", 1],
      ["clientTransactionId", randomUUID()],
      ["currency", "EUR"],
    ]) {
      const original = sale[field];
      sale[field] = value;
      await assert.rejects(
        settle(provider, payment, "approved"),
        ProviderSaleMismatchError,
      );
      sale[field] = original;
    }
    const after = await state(order);
    assert.equal(after.order.status, "pending_payment");
    assert.equal(after.receipts.length, 0);
  });

  test("pending sales, unknown payments and an unreachable PayPhone change nothing", async () => {
    const provider = fakePayPhone();
    const order = await createOrder();
    const payment = await startWithFake(provider, order);
    assert.deepEqual(await settle(provider, payment, "pending"), {
      kind: "pending",
    });
    provider.unavailable = true;
    await assert.rejects(
      settle(provider, payment, "approved"),
      PaymentProviderUnavailableError,
    );
    const unknown = randomUUID();
    const response = await fetch(
      `${root}${CALLBACK_PATH}/${signCallback(SECRET, unknown)}?id=1&clientTransactionID=${unknown}`,
    );
    assert.equal(response.status, 404);
    const missing = await fetch(
      `${root}${CALLBACK_PATH}/${signCallback(SECRET, unknown)}`,
    );
    assert.equal(missing.status, 400);
    const after = await state(order);
    assert.equal(after.order.status, "pending_payment");
    assert.equal(after.receipts.length, 0);
  });
});
