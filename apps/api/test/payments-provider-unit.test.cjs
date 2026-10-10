const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PayPhoneProvider,
  StatusQueryBudget,
  PAYPHONE_BASE_URL,
} = require("../dist/modules/payments/infrastructure/payphone.provider");
const {
  SimulatedPaymentProvider,
} = require("../dist/modules/payments/infrastructure/simulated.provider");
const {
  PaymentProviderRejectedError,
  PaymentProviderUnavailableError,
} = require("../dist/modules/payments/domain/payment-provider.port");

const TOKEN = "test-token-must-never-leak";

/** Fake fetch: records calls and answers from a queue; never hits the network. */
function fakeFetch(...responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(
      next.body === undefined ? null : JSON.stringify(next.body),
      { status: next.status ?? 200 },
    );
  };
  return { impl, calls };
}

function provider(fetchImpl, { storeId = null, budget } = {}) {
  return new PayPhoneProvider(
    { token: TOKEN, storeId },
    budget ?? new StatusQueryBudget(),
    fetchImpl,
  );
}

const SALE_REQUEST = {
  clientTransactionId: "c-123",
  phoneNumber: "991234567",
  countryCode: "593",
  amountMinor: 3450,
  amountWithTaxMinor: 3000,
  amountWithoutTaxMinor: 0,
  taxMinor: 450,
  currency: "USD",
  reference: "Pedido demo",
  responseUrl: "https://demo.example.com/api/v1/payments/payphone/callback/sig",
};

function sale(overrides = {}) {
  return {
    transactionId: 45441137,
    clientTransactionId: "c-123",
    statusCode: 3,
    transactionStatus: "Approved",
    amount: 3450,
    currency: "USD",
    ...overrides,
  };
}

async function assertNoLeak(promise, ErrorType) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ErrorType, error.name);
    assert.doesNotMatch(error.message, /must-never-leak/);
    return true;
  });
}

test("createSale posts the backend amounts with the server token", async () => {
  const { impl, calls } = fakeFetch({ body: { transactionId: 45441137 } });
  const result = await provider(impl).createSale(SALE_REQUEST);
  assert.deepEqual(result, { transactionId: "45441137" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PAYPHONE_BASE_URL}/api/Sale`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(calls[0].init.signal, "requests must have a timeout");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    phoneNumber: "991234567",
    countryCode: "593",
    amount: 3450,
    amountWithoutTax: 0,
    amountWithTax: 3000,
    tax: 450,
    service: 0,
    tip: 0,
    currency: "USD",
    clientTransactionId: "c-123",
    reference: "Pedido demo",
    responseUrl: SALE_REQUEST.responseUrl,
  });
  assert.equal(
    body.amount,
    body.amountWithoutTax +
      body.amountWithTax +
      body.tax +
      body.service +
      body.tip,
  );
});

test("storeId is sent only when configured", async () => {
  const { impl, calls } = fakeFetch({ body: { transactionId: 1 } });
  await provider(impl, { storeId: "store-1" }).createSale(SALE_REQUEST);
  assert.equal(JSON.parse(calls[0].init.body).storeId, "store-1");
});

test("status codes 1, 2 and 3 map to pending, canceled and approved", async () => {
  for (const [statusCode, status] of [
    [1, "pending"],
    [2, "canceled"],
    [3, "approved"],
  ]) {
    const { impl, calls } = fakeFetch({ body: sale({ statusCode }) });
    assert.deepEqual(await provider(impl).getSale("45441137"), {
      transactionId: "45441137",
      clientTransactionId: "c-123",
      status,
      amountMinor: 3450,
      currency: "USD",
    });
    assert.equal(calls[0].url, `${PAYPHONE_BASE_URL}/api/Sale/45441137`);
    assert.equal(calls[0].init.method, "GET");
  }
});

test("malformed provider responses are never trusted", async () => {
  for (const body of [
    null,
    [],
    sale({ statusCode: 9 }),
    sale({ statusCode: "3" }),
    sale({ amount: "3450" }),
    sale({ amount: 34.5 }),
    sale({ transactionId: null }),
    sale({ clientTransactionId: undefined }),
  ]) {
    const { impl } = fakeFetch({ body });
    await assertNoLeak(
      provider(impl).getSale("1"),
      PaymentProviderUnavailableError,
    );
  }
  const { impl } = fakeFetch({ body: { ok: true } });
  await assertNoLeak(
    provider(impl).createSale(SALE_REQUEST),
    PaymentProviderUnavailableError,
  );
});

test("timeouts, 429 and 5xx are temporary; other errors are rejections with PayPhone's message", async () => {
  const timeout = new DOMException("The operation timed out", "TimeoutError");
  for (const response of [
    timeout,
    new TypeError("fetch failed"),
    { status: 429, body: { message: "Too many" } },
    { status: 503 },
  ]) {
    const { impl } = fakeFetch(response);
    await assertNoLeak(
      provider(impl).createSale(SALE_REQUEST),
      PaymentProviderUnavailableError,
    );
  }
  const { impl } = fakeFetch({
    status: 400,
    body: {
      message: "General",
      errorCode: 120,
      errors: [
        { message: "El teléfono no tiene cuenta Payphone", errorCode: 21 },
      ],
    },
  });
  await assert.rejects(provider(impl).createSale(SALE_REQUEST), (error) => {
    assert.ok(error instanceof PaymentProviderRejectedError);
    assert.equal(error.message, "El teléfono no tiene cuenta Payphone");
    return true;
  });
});

test("status queries stop locally at 30 per minute without calling PayPhone", async () => {
  let now = 0;
  const budget = new StatusQueryBudget(30, () => now);
  const responses = Array.from({ length: 31 }, () => ({ body: sale() }));
  const { impl, calls } = fakeFetch(...responses);
  const payphone = provider(impl, { budget });
  for (let i = 0; i < 30; i += 1) await payphone.getSale("1");
  await assertNoLeak(payphone.getSale("1"), PaymentProviderUnavailableError);
  assert.equal(calls.length, 30);
  now = 60_000;
  await payphone.getSale("1");
  assert.equal(calls.length, 31);
});

test("lookup by clientTransactionId returns only the requested sale", async () => {
  let fake = fakeFetch({ status: 404, body: { message: "Not found" } });
  assert.equal(
    await provider(fake.impl).findSaleByClientTransactionId("c-123"),
    null,
  );
  assert.equal(fake.calls[0].url, `${PAYPHONE_BASE_URL}/api/Sale/client/c-123`);
  fake = fakeFetch({
    body: [sale({ clientTransactionId: "other" }), sale()],
  });
  assert.equal(
    (await provider(fake.impl).findSaleByClientTransactionId("c-123"))
      .clientTransactionId,
    "c-123",
  );
  fake = fakeFetch({ body: sale({ clientTransactionId: "other" }) });
  assert.equal(
    await provider(fake.impl).findSaleByClientTransactionId("c-123"),
    null,
  );
});

test("simulated provider resolves every sale to the configured outcome", async () => {
  for (const outcome of ["approved", "canceled", "rejected"]) {
    const simulated = new SimulatedPaymentProvider(outcome);
    const { transactionId } = await simulated.createSale(SALE_REQUEST);
    assert.match(transactionId, /^SIM-/);
    const found = await simulated.getSale(transactionId);
    assert.equal(found.status, outcome);
    assert.equal(found.amountMinor, 3450);
    assert.deepEqual(
      await simulated.findSaleByClientTransactionId("c-123"),
      found,
    );
  }
  await assert.rejects(
    new SimulatedPaymentProvider("approved").getSale("missing"),
    PaymentProviderRejectedError,
  );
});
