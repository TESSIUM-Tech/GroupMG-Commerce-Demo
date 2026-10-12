const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
// Payments disabled for the app itself: this file drives the use cases with
// its own fake PayPhone, so no background job touches the test data.
process.env.PAYMENTS_MODE = "disabled";
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
  ReconcilePaymentsUseCase,
  RECONCILE_BATCH,
} = require("../dist/modules/payments/application/reconcile-payments.use-case");
const {
  SimulatedPaymentProvider,
} = require("../dist/modules/payments/infrastructure/simulated.provider");
const {
  PaymentProviderUnavailableError,
} = require("../dist/modules/payments/domain/payment-provider.port");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Payment tests require the isolated commerce_issue2_test database and ALLOW_DB_TESTS=true",
  );
}

describe("Payment reconciliation with PostgreSQL", () => {
  let app, prisma, api, repository;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const categoryId = randomUUID();
  const product = { id: randomUUID(), sku: `T09R-${tag}-A` };
  const config = {
    mode: "payphone",
    payphone: null,
    responseBaseUrl: "https://demo.example.com",
    callbackSecret: "r".repeat(40),
    simulatedOutcome: "approved",
  };
  let nextTransactionId = 100_000_000 + Math.floor(Math.random() * 800_000_000);

  /** Fake PayPhone. `lose` drops the create response; `ghost` never creates. */
  const payphone = {
    sales: new Map(),
    unavailable: false,
    mode: "ok",
    async createSale(request) {
      if (this.mode === "ghost") {
        throw new PaymentProviderUnavailableError(
          "PayPhone did not respond in time",
        );
      }
      const transactionId = String(nextTransactionId++);
      this.sales.set(transactionId, {
        transactionId,
        clientTransactionId: request.clientTransactionId,
        status: "pending",
        amountMinor: request.amountMinor,
        currency: request.currency,
      });
      if (this.mode === "lose") {
        throw new PaymentProviderUnavailableError(
          "PayPhone did not respond in time",
        );
      }
      return { transactionId };
    },
    async getSale(transactionId) {
      if (this.unavailable) {
        throw new PaymentProviderUnavailableError(
          "PayPhone did not respond in time",
        );
      }
      return { ...this.sales.get(transactionId) };
    },
    async findSaleByClientTransactionId(clientTransactionId) {
      if (this.unavailable) {
        throw new PaymentProviderUnavailableError(
          "PayPhone did not respond in time",
        );
      }
      for (const sale of this.sales.values()) {
        if (sale.clientTransactionId === clientTransactionId)
          return { ...sale };
      }
      return null;
    },
  };

  function useCases(provider = payphone) {
    const callback = new HandlePayPhoneCallbackUseCase(
      repository,
      provider,
      config,
    );
    return {
      start: new StartPaymentUseCase(repository, provider, config),
      reconcile: new ReconcilePaymentsUseCase(repository, provider, callback),
    };
  }

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
    repository = app.get(PrismaPaymentsRepository);
    await prisma.category.create({
      data: {
        id: categoryId,
        slug: `t09r-${tag.toLowerCase()}`,
        name: "Reconcile test",
      },
    });
    await prisma.product.create({
      data: {
        id: product.id,
        sku: product.sku,
        supplierReference: product.sku,
        name: "Reconcile test product",
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
      if (prisma)
        await prisma.$transaction(async (tx) => {
          const orders = await tx.order.findMany({
            where: { items: { some: { productId: product.id } } },
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
          await tx.inventory.deleteMany({ where: { productId: product.id } });
          await tx.product.deleteMany({ where: { id: product.id } });
          await tx.category.deleteMany({ where: { id: categoryId } });
        });
    } finally {
      if (app) await app.close();
    }
  });

  async function createOrder() {
    const response = await fetch(`${api}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        items: [{ sku: product.sku, quantity: 1 }],
        customer: {
          firstName: "Rec",
          lastName: "Demo",
          email: "rec@example.invalid",
          phone: "0991234567",
        },
        fulfillment: { type: "pickup" },
        billing: {
          identificationType: "cedula",
          identification: "1710034065",
          name: "Rec Demo",
          email: "rec@example.invalid",
          address: "Quito",
        },
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    return { id: body.order.id, token: body.accessToken };
  }

  async function startPayment(mode = "ok", provider = payphone) {
    const order = await createOrder();
    payphone.mode = mode;
    try {
      await useCases(provider).start.execute(order.id, order.token);
    } finally {
      payphone.mode = "ok";
    }
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    return { order, payment };
  }

  async function age(payment, minutes) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { createdAt: new Date(Date.now() - minutes * 60_000) },
    });
  }

  function saleOf(payment) {
    for (const sale of payphone.sales.values()) {
      if (sale.clientTransactionId === payment.clientTransactionId) return sale;
    }
    return null;
  }

  const orderStatus = async (order) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status;
  const paymentStatus = async (payment) =>
    (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .status;

  test("a lost callback is recovered by asking PayPhone", async () => {
    const { order, payment } = await startPayment();
    saleOf(payment).status = "approved";
    await age(payment, 2);
    const summary = await useCases().reconcile.execute();
    assert.equal(summary.settled, 1);
    assert.equal(await orderStatus(order), "confirmed");
    assert.equal(await paymentStatus(payment), "approved");
    assert.equal(
      await prisma.outboxEvent.count({ where: { orderId: order.id } }),
      1,
    );
    assert.equal((await useCases().reconcile.execute()).checked, 0);
  });

  test("recent payments wait for their callback; pending sales stay pending", async () => {
    const { order, payment } = await startPayment();
    saleOf(payment).status = "approved";
    assert.equal((await useCases().reconcile.execute()).checked, 0);
    assert.equal(await orderStatus(order), "pending_payment");
    saleOf(payment).status = "pending";
    await age(payment, 2);
    const summary = await useCases().reconcile.execute();
    assert.equal(summary.stillPending, 1);
    assert.equal(await paymentStatus(payment), "pending");
    saleOf(payment).status = "canceled";
    assert.equal((await useCases().reconcile.execute()).settled, 1);
    assert.equal(await orderStatus(order), "canceled");
  });

  test("a creation timeout is not a rejection: the sale is found and settled", async () => {
    const { order, payment } = await startPayment("lose");
    assert.equal(payment.providerTransactionId, null);
    saleOf(payment).status = "approved";
    await age(payment, 2);
    assert.equal((await useCases().reconcile.execute()).settled, 1);
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    assert.equal(stored.providerTransactionId, saleOf(payment).transactionId);
    assert.equal(stored.status, "approved");
    assert.equal(await orderStatus(order), "confirmed");
  });

  test("a sale PayPhone never created is abandoned only after 10 minutes", async () => {
    const { order, payment } = await startPayment("ghost");
    await age(payment, 2);
    assert.equal((await useCases().reconcile.execute()).stillPending, 1);
    assert.equal(await paymentStatus(payment), "pending");
    await age(payment, 11);
    assert.equal((await useCases().reconcile.execute()).abandoned, 1);
    assert.equal(await paymentStatus(payment), "canceled");
    assert.equal(await orderStatus(order), "pending_payment");
  });

  test("data that does not match is flagged for review instead of retried forever", async () => {
    const { order, payment } = await startPayment();
    Object.assign(saleOf(payment), { status: "approved", amountMinor: 1 });
    await age(payment, 2);
    assert.equal((await useCases().reconcile.execute()).flagged, 1);
    assert.equal(await paymentStatus(payment), "review_required");
    assert.equal(await orderStatus(order), "pending_payment");
    assert.equal(
      await prisma.outboxEvent.count({ where: { orderId: order.id } }),
      0,
    );
  });

  test("an unreachable PayPhone stops the run without changing anything", async () => {
    const { order, payment } = await startPayment();
    saleOf(payment).status = "approved";
    await age(payment, 2);
    payphone.unavailable = true;
    const stopped = await useCases().reconcile.execute();
    payphone.unavailable = false;
    assert.equal(stopped.stopped, true);
    assert.equal(await paymentStatus(payment), "pending");
    assert.equal((await useCases().reconcile.execute()).settled, 1);
    assert.equal(await orderStatus(order), "confirmed");
  });

  test(`each run queries at most ${RECONCILE_BATCH} payments, oldest first`, async () => {
    const started = [];
    for (let i = 0; i < RECONCILE_BATCH + 2; i += 1) {
      const { payment } = await startPayment();
      saleOf(payment).status = "canceled";
      await age(payment, 30 - i);
      started.push(payment);
    }
    const first = await useCases().reconcile.execute();
    assert.equal(first.checked, RECONCILE_BATCH);
    assert.equal(await paymentStatus(started[0]), "canceled");
    assert.equal(await paymentStatus(started[RECONCILE_BATCH + 1]), "pending");
    const second = await useCases().reconcile.execute();
    assert.equal(second.checked, 2);
    assert.equal(await paymentStatus(started[RECONCILE_BATCH + 1]), "canceled");
  });

  test("simulated mode: reconciliation resolves the demo's simulated rejection", async () => {
    const simulated = new SimulatedPaymentProvider("rejected");
    const { order, payment } = await startPayment("ok", simulated);
    await age(payment, 2);
    const summary = await useCases(simulated).reconcile.execute();
    assert.equal(summary.settled, 1);
    assert.equal(await paymentStatus(payment), "rejected");
    assert.equal(await orderStatus(order), "canceled");
  });
});
