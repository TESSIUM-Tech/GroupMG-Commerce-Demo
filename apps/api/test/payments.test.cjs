const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
// Deterministic provider for this process; never reaches PayPhone.
const SECRET = "t".repeat(40);
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
  PAYMENT_WINDOW_MS,
} = require("../dist/modules/payments/application/start-payment.use-case");
const {
  verifyCallbackSignature,
  CALLBACK_PATH,
} = require("../dist/modules/payments/application/callback-signature");
const {
  PaymentProviderRejectedError,
  PaymentProviderUnavailableError,
} = require("../dist/modules/payments/domain/payment-provider.port");
const {
  PaymentRefusedByProviderError,
  PaymentsDisabledError,
} = require("../dist/modules/payments/domain/payment-errors");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Payment tests require the isolated commerce_issue2_test database and ALLOW_DB_TESTS=true",
  );
}

describe("Start payment with PostgreSQL", () => {
  let app, prisma, origin;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const categoryId = randomUUID();
  const product = { id: randomUUID(), sku: `T09-${tag}-A`, price: 1000 };
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
    await app.listen(0, "127.0.0.1");
    origin = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    prisma = app.get(PrismaService);
    await prisma.category.create({
      data: {
        id: categoryId,
        slug: `t09-${tag.toLowerCase()}`,
        name: "Payments test",
      },
    });
    await prisma.product.create({
      data: {
        id: product.id,
        sku: product.sku,
        supplierReference: product.sku,
        name: "Payments test product",
        categoryId,
        priceMinor: product.price,
        currency: "USD",
        taxRateBps: 1500,
        imageUrl: "/demo/products/MG-DEMO-001.svg",
        imageLicense: "test",
        published: true,
        inventory: { create: { onHand: 100 } },
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

  async function createOrder(phone = "0991234567", quantity = 3) {
    const response = await fetch(`${origin}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        items: [{ sku: product.sku, quantity }],
        customer: {
          firstName: "Pago",
          lastName: "Demo",
          email: "pago@example.invalid",
          phone,
        },
        fulfillment: { type: "pickup" },
        billing: {
          identificationType: "cedula",
          identification: "1710034065",
          name: "Pago Demo",
          email: "pago@example.invalid",
          address: "Quito",
        },
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    return { id: body.order.id, token: body.accessToken, order: body.order };
  }

  async function pay(order, body = {}, authorization) {
    const response = await fetch(`${origin}/orders/${order.id}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === null
          ? {}
          : { authorization: authorization ?? `Bearer ${order.token}` }),
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  }

  function paymentsOf(orderId) {
    return prisma.payment.findMany({ where: { orderId } });
  }

  /** Provider stub that records the sale request and answers as told. */
  function fakeProvider(answer) {
    const requests = [];
    return {
      requests,
      createSale: async (request) => {
        requests.push(request);
        if (answer instanceof Error) throw answer;
        return { transactionId: answer };
      },
      getSale: async () => assert.fail("not used"),
      findSaleByClientTransactionId: async () => assert.fail("not used"),
    };
  }

  function useCase(provider) {
    return new StartPaymentUseCase(
      app.get(PrismaPaymentsRepository),
      provider,
      config,
    );
  }

  test("starts a pending payment for the server total and extends the reservation", async () => {
    const order = await createOrder();
    const startedAt = Date.now();
    const { response, body } = await pay(order);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.nextStep, "approve_in_payphone_app");
    assert.equal(body.payment.status, "pending");
    assert.equal(body.payment.amountMinor, order.order.totalMinor);
    assert.equal(body.payment.amountMinor, 3450);
    assert.equal(body.correlationId, response.headers.get("x-correlation-id"));

    const [stored] = await paymentsOf(order.id);
    assert.match(stored.providerTransactionId, /^SIM-/);
    assert.equal(stored.status, "pending");
    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { reservations: true },
    });
    assert.equal(dbOrder.status, "pending_payment");
    const extendedBy = dbOrder.reservationExpiresAt.getTime() - startedAt;
    assert.ok(
      extendedBy >= PAYMENT_WINDOW_MS - 1000 &&
        extendedBy <= PAYMENT_WINDOW_MS + 5000,
      `reservation extended by ${extendedBy} ms`,
    );
    assert.ok(
      dbOrder.reservationExpiresAt > new Date(order.order.reservationExpiresAt),
    );
    for (const reservation of dbOrder.reservations) {
      assert.equal(
        reservation.expiresAt.getTime(),
        dbOrder.reservationExpiresAt.getTime(),
      );
    }
  });

  test("paying again returns the pending payment instead of charging twice", async () => {
    const order = await createOrder();
    const first = await pay(order);
    const second = await pay(order);
    assert.equal(first.response.status, 201);
    assert.equal(second.response.status, 200);
    assert.equal(second.body.payment.id, first.body.payment.id);
    assert.equal((await paymentsOf(order.id)).length, 1);
  });

  test("simultaneous clicks on pay create a single payment", async () => {
    const order = await createOrder();
    const results = await Promise.all([pay(order), pay(order), pay(order)]);
    assert.deepEqual(
      results.map((r) => r.response.status).sort(),
      [200, 200, 201],
    );
    assert.equal(new Set(results.map((r) => r.body.payment.id)).size, 1);
    assert.equal((await paymentsOf(order.id)).length, 1);
  });

  test("requires the order's own token", async () => {
    const order = await createOrder();
    const other = await createOrder();
    assert.equal((await pay(order, {}, null)).response.status, 401);
    const wrong = await pay(order, {}, `Bearer ${other.token}`);
    assert.equal(wrong.response.status, 404);
    assert.equal(wrong.body.message, "Order not found");
    const badId = await fetch(`${origin}/orders/not-a-uuid/payments`, {
      method: "POST",
      headers: { authorization: `Bearer ${order.token}` },
    });
    assert.equal(badId.status, 400);
    assert.equal((await paymentsOf(order.id)).length, 0);
  });

  test("an expired reservation or a non-pending order cannot be paid", async () => {
    const expired = await createOrder();
    await prisma.$executeRaw`
      UPDATE "Order" SET "createdAt" = now() - interval '10 minutes',
        "reservationExpiresAt" = now() - interval '5 minutes'
      WHERE "id" = ${expired.id}::uuid`;
    const late = await pay(expired);
    assert.equal(late.response.status, 409);
    assert.match(late.body.message, /reservation expired/);

    const canceled = await createOrder();
    await prisma.order.update({
      where: { id: canceled.id },
      data: { status: "canceled" },
    });
    const notPending = await pay(canceled);
    assert.equal(notPending.response.status, 409);
    assert.equal(notPending.body.orderStatus, "canceled");
    assert.equal((await paymentsOf(expired.id)).length, 0);
    assert.equal((await paymentsOf(canceled.id)).length, 0);
  });

  test("only Ecuadorian mobiles can pay; another phone may be given", async () => {
    const landline = await createOrder("022345678");
    assert.equal((await pay(landline)).response.status, 422);
    const badOverride = await createOrder();
    assert.equal(
      (await pay(badOverride, { phone: "+573001234567" })).response.status,
      422,
    );
    assert.equal((await paymentsOf(landline.id)).length, 0);
    assert.equal((await paymentsOf(badOverride.id)).length, 0);
    const override = await pay(landline, { phone: "+593 99 123 4567" });
    assert.equal(override.response.status, 201);
  });

  test("the request body cannot carry amounts", async () => {
    const order = await createOrder();
    for (const body of [
      { amountMinor: 1 },
      { totalMinor: 1 },
      { status: "approved" },
    ]) {
      assert.equal((await pay(order, body)).response.status, 400);
    }
    assert.equal((await paymentsOf(order.id)).length, 0);
  });

  test("PayPhone receives the split amounts, normalized phone and a signed callback URL", async () => {
    const order = await createOrder("0991234567", 2);
    const provider = fakeProvider("45441137");
    const result = await useCase(provider).execute(order.id, order.token);
    assert.equal(result.outcome, "created");
    const [request] = provider.requests;
    assert.equal(request.phoneNumber, "991234567");
    assert.equal(request.countryCode, "593");
    assert.equal(request.amountMinor, 2300);
    assert.equal(request.amountWithTaxMinor, 2000);
    assert.equal(request.amountWithoutTaxMinor, 0);
    assert.equal(request.taxMinor, 300);
    assert.equal(request.currency, "USD");
    assert.doesNotMatch(
      request.reference,
      /example\.invalid|Pago Demo|1710034065/,
    );
    const prefix = `https://demo.example.com${CALLBACK_PATH}/`;
    assert.ok(request.responseUrl.startsWith(prefix));
    assert.equal(
      verifyCallbackSignature(
        SECRET,
        request.clientTransactionId,
        request.responseUrl.slice(prefix.length),
      ),
      true,
    );
    const [stored] = await paymentsOf(order.id);
    assert.equal(stored.providerTransactionId, "45441137");
    assert.equal(stored.clientTransactionId, request.clientTransactionId);
  });

  test("a sale refused by PayPhone leaves the order payable for a retry", async () => {
    const order = await createOrder();
    const refusing = fakeProvider(
      new PaymentProviderRejectedError("El teléfono no tiene cuenta Payphone"),
    );
    await assert.rejects(
      useCase(refusing).execute(order.id, order.token),
      (error) =>
        error instanceof PaymentRefusedByProviderError &&
        /no tiene cuenta Payphone/.test(error.message),
    );
    let payments = await paymentsOf(order.id);
    assert.deepEqual(
      payments.map((p) => p.status),
      ["canceled"],
    );
    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    assert.equal(dbOrder.status, "pending_payment");

    const retry = await useCase(fakeProvider("999")).execute(
      order.id,
      order.token,
    );
    assert.equal(retry.outcome, "created");
    payments = await paymentsOf(order.id);
    assert.deepEqual(payments.map((p) => p.status).sort(), [
      "canceled",
      "pending",
    ]);
    assert.notEqual(
      payments[0].clientTransactionId,
      payments[1].clientTransactionId,
    );
  });

  test("a PayPhone timeout is not a rejection: the payment stays pending", async () => {
    const order = await createOrder();
    const silent = fakeProvider(
      new PaymentProviderUnavailableError("PayPhone did not respond in time"),
    );
    const result = await useCase(silent).execute(order.id, order.token);
    assert.equal(result.outcome, "unconfirmed");
    const [stored] = await paymentsOf(order.id);
    assert.equal(stored.status, "pending");
    assert.equal(stored.providerTransactionId, null);
    // A retry reuses it instead of opening a second sale.
    const again = await useCase(fakeProvider("1")).execute(
      order.id,
      order.token,
    );
    assert.equal(again.outcome, "existing");
    assert.equal((await paymentsOf(order.id)).length, 1);
  });

  test("payments are refused when the server has no provider configured", async () => {
    const order = await createOrder();
    await assert.rejects(
      new StartPaymentUseCase(app.get(PrismaPaymentsRepository), null, {
        ...config,
        mode: "disabled",
        callbackSecret: null,
      }).execute(order.id, order.token),
      PaymentsDisabledError,
    );
    assert.equal((await paymentsOf(order.id)).length, 0);
  });
});
