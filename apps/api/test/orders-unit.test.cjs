const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
require("reflect-metadata");
const { BadRequestException } = require("@nestjs/common");
const {
  canTransition,
  assertTransition,
  ORDER_STATUSES,
} = require("../dist/modules/orders/domain/order-status");
const {
  InvalidOrderTransitionError,
  IdempotencyKeyReusedError,
  OrderAmountOutOfRangeError,
} = require("../dist/modules/orders/domain/order-errors");
const {
  priceOrder,
  taxFor,
} = require("../dist/modules/orders/domain/order-pricing");
const {
  generateAccessToken,
  hashAccessToken,
  hashRequest,
} = require("../dist/modules/orders/application/order-security");
const {
  CreateOrderUseCase,
} = require("../dist/modules/orders/application/create-order.use-case");
const {
  toCreateOrderCommand,
  parseIdempotencyKey,
  parseBearerToken,
} = require("../dist/modules/orders/presentation/order-http.mapper");

test("order transitions allow only the documented paths", () => {
  const allowed = [
    ["pending_payment", "confirmed"],
    ["pending_payment", "canceled"],
    ["pending_payment", "expired"],
    ["pending_payment", "review_required"],
    ["review_required", "confirmed"],
    ["review_required", "canceled"],
  ];
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const expected = allowed.some(([f, t]) => f === from && t === to);
      assert.equal(canTransition(from, to), expected, `${from} -> ${to}`);
    }
  }
});

test("invalid transitions are rejected with a domain error", () => {
  for (const [from, to] of [
    ["expired", "confirmed"],
    ["confirmed", "canceled"],
    ["canceled", "pending_payment"],
    ["pending_payment", "pending_payment"],
    ["review_required", "expired"],
  ]) {
    assert.throws(
      () => assertTransition(from, to),
      (error) =>
        error instanceof InvalidOrderTransitionError &&
        error.from === from &&
        error.to === to,
    );
  }
  assert.doesNotThrow(() => assertTransition("pending_payment", "expired"));
});

test("tax per line rounds half up exactly like the item_money CHECK", () => {
  assert.equal(taxFor(850, 1500), 128); // 127.5
  assert.equal(taxFor(590, 1500), 89); // 88.5
  assert.equal(taxFor(1290, 1500), 194); // 193.5
  assert.equal(taxFor(1000, 1500), 150);
  assert.equal(taxFor(1000, 0), 0);
  for (const [base, bps] of [
    [19900, 1500],
    [3 * 2490, 1500],
    [7, 1234],
  ]) {
    assert.equal(taxFor(base, bps), Math.floor((base * bps + 5000) / 10000));
  }
});

test("order totals come from product data and include shipping tax", () => {
  const totals = priceOrder(
    [
      { product: { sku: "A", priceMinor: 850, taxRateBps: 1500 }, quantity: 3 },
      {
        product: { sku: "B", priceMinor: 19900, taxRateBps: 1500 },
        quantity: 1,
      },
    ],
    { amountMinor: 300, taxRateBps: 1500 },
  );
  assert.deepEqual(totals.lines[0], {
    sku: "A",
    quantity: 3,
    unitPriceMinor: 850,
    taxRateBps: 1500,
    taxMinor: 383, // 2550 * 0.15 = 382.5
    totalMinor: 2933,
  });
  assert.equal(totals.subtotalMinor, 2550 + 19900);
  assert.equal(totals.taxMinor, 383 + 2985);
  assert.equal(totals.shippingMinor, 300);
  assert.equal(totals.shippingTaxMinor, 45);
  assert.equal(totals.totalMinor, 22450 + 3368 + 300 + 45);
  const pickup = priceOrder(
    [
      {
        product: { sku: "A", priceMinor: 1000, taxRateBps: 1500 },
        quantity: 1,
      },
    ],
    null,
  );
  assert.equal(pickup.shippingMinor + pickup.shippingTaxMinor, 0);
  assert.equal(pickup.totalMinor, 1150);
});

test("amounts beyond the PostgreSQL integer range are rejected", () => {
  assert.throws(
    () =>
      priceOrder(
        [
          {
            product: { sku: "A", priceMinor: 2_000_000_000, taxRateBps: 1500 },
            quantity: 2,
          },
        ],
        null,
      ),
    OrderAmountOutOfRangeError,
  );
});

test("request hash ignores key order but detects any change", () => {
  const a = { items: [{ sku: "A", quantity: 1 }], customer: { x: 1, y: 2 } };
  const b = { customer: { y: 2, x: 1 }, items: [{ quantity: 1, sku: "A" }] };
  assert.equal(hashRequest(a), hashRequest(b));
  assert.match(hashRequest(a), /^[0-9a-f]{64}$/);
  assert.notEqual(
    hashRequest(a),
    hashRequest({ ...a, items: [{ sku: "A", quantity: 2 }] }),
  );
});

test("access tokens are 32 random bytes and only their SHA-256 is stored", () => {
  const first = generateAccessToken();
  const second = generateAccessToken();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first.token, "base64url").length, 32);
  assert.notEqual(first.token, second.token);
  assert.equal(
    first.hash,
    createHash("sha256").update(first.token).digest("hex"),
  );
  assert.equal(hashAccessToken(first.token), first.hash);
  assert.equal(parseBearerToken(`Bearer ${first.token}`), first.token);
  for (const header of [
    undefined,
    "",
    first.token,
    "Bearer x",
    `Basic ${first.token}`,
  ]) {
    assert.equal(parseBearerToken(header), null);
  }
});

function dto(overrides = {}) {
  return {
    items: [
      { sku: "MG-DEMO-002", quantity: 1 },
      { sku: "MG-DEMO-001", quantity: 2 },
    ],
    customer: {
      firstName: "Ana",
      lastName: "Demo",
      email: "ana@example.invalid",
      phone: "0991234567",
    },
    fulfillment: { type: "pickup" },
    billing: {
      identificationType: "cedula",
      identification: "1710034065",
      name: "Ana Demo",
      email: "ana@example.invalid",
      address: "Quito",
    },
    ...overrides,
  };
}

test("request mapping sorts items and enforces cross-field rules", () => {
  const command = toCreateOrderCommand(dto());
  assert.deepEqual(
    command.items.map((item) => item.sku),
    ["MG-DEMO-001", "MG-DEMO-002"],
  );
  assert.deepEqual(command.fulfillment, { type: "pickup" });
  const invalid = [
    dto({
      items: [
        { sku: "MG-DEMO-001", quantity: 1 },
        { sku: "MG-DEMO-001", quantity: 2 },
      ],
    }),
    dto({
      fulfillment: {
        type: "pickup",
        shippingAddress: {
          province: "P",
          city: "C",
          zone: "Z",
          address: "A",
          reference: "R",
        },
      },
    }),
    dto({ billing: { ...dto().billing, identification: "123" } }),
    dto({
      billing: {
        ...dto().billing,
        identificationType: "ruc",
        identification: "1710034065",
      },
    }),
    dto({
      billing: {
        ...dto().billing,
        identificationType: "passport",
        identification: "A-1",
      },
    }),
  ];
  for (const body of invalid) {
    assert.throws(() => toCreateOrderCommand(body), BadRequestException);
  }
});

test("idempotency key header must be present and well formed", () => {
  assert.equal(
    parseIdempotencyKey("2b0f6a52-6c1d-4a0e-9a53-3f1e0c2a1b7d"),
    "2b0f6a52-6c1d-4a0e-9a53-3f1e0c2a1b7d",
  );
  for (const header of [
    undefined,
    "",
    "short",
    "has spaces in the key!",
    "x".repeat(129),
  ]) {
    assert.throws(() => parseIdempotencyKey(header), BadRequestException);
  }
});

test("a replay with a different payload is rejected and a matching one rotates the token", async () => {
  const order = { id: "order-1" };
  const replaced = [];
  const repository = (requestHash) => ({
    createPendingOrder: async () => ({ created: false, order, requestHash }),
    replaceAccessToken: async (...args) => replaced.push(args),
  });
  const command = toCreateOrderCommand(dto());
  await assert.rejects(
    new CreateOrderUseCase(repository("0".repeat(64))).execute("key", command),
    IdempotencyKeyReusedError,
  );
  assert.equal(replaced.length, 0);

  const result = await new CreateOrderUseCase(
    repository(hashRequest(command)),
  ).execute("key", command);
  assert.equal(result.replayed, true);
  assert.equal(result.order, order);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0][0], "order-1");
  assert.equal(replaced[0][1], hashAccessToken(result.accessToken));
});
