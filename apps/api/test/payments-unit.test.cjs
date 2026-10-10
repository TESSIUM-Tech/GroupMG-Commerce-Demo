const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  decideApprovedPayment,
} = require("../dist/modules/payments/domain/approved-payment-policy");
const {
  ORDER_STATUSES,
  canTransition,
} = require("../dist/modules/orders/domain/order-status");
const {
  loadPaymentsConfig,
  PaymentsConfigError,
} = require("../dist/modules/payments/infrastructure/payments.config");
const {
  decideFailedPayment,
} = require("../dist/modules/payments/domain/failed-payment-policy");

test("a canceled or rejected pending payment cancels the order and releases stock once", () => {
  for (const outcome of ["canceled", "rejected"]) {
    assert.deepEqual(
      decideFailedPayment({
        outcome,
        paymentStatus: "pending",
        orderStatus: "pending_payment",
        otherPendingPayments: false,
      }),
      {
        paymentStatus: outcome,
        orderStatus: "canceled",
        releaseReservations: true,
        reason: "order_canceled",
      },
    );
  }
});

test("a cancellation after an approval is ignored: never un-confirm", () => {
  for (const orderStatus of ORDER_STATUSES) {
    assert.deepEqual(
      decideFailedPayment({
        outcome: "canceled",
        paymentStatus: "approved",
        orderStatus,
        otherPendingPayments: false,
      }),
      {
        paymentStatus: null,
        orderStatus: null,
        releaseReservations: false,
        reason: "after_approval_ignored",
      },
    );
  }
});

test("failed payments never touch orders that are no longer pending or still payable", () => {
  for (const orderStatus of [
    "confirmed",
    "expired",
    "canceled",
    "review_required",
  ]) {
    const decision = decideFailedPayment({
      outcome: "canceled",
      paymentStatus: "pending",
      orderStatus,
      otherPendingPayments: false,
    });
    assert.equal(decision.paymentStatus, "canceled");
    assert.equal(decision.orderStatus, null);
    assert.equal(decision.releaseReservations, false);
  }
  const other = decideFailedPayment({
    outcome: "rejected",
    paymentStatus: "pending",
    orderStatus: "pending_payment",
    otherPendingPayments: true,
  });
  assert.equal(other.orderStatus, null);
  assert.equal(other.releaseReservations, false);
  for (const paymentStatus of ["canceled", "rejected", "review_required"]) {
    assert.equal(
      decideFailedPayment({
        outcome: "canceled",
        paymentStatus,
        orderStatus: "pending_payment",
        otherPendingPayments: false,
      }).reason,
      "already_final",
    );
  }
});

const SECRET = "s".repeat(40);
const PAYPHONE_ENV = {
  PAYMENTS_MODE: "payphone",
  PAYMENTS_CALLBACK_SECRET: SECRET,
  PAYPHONE_TOKEN: "token-value-must-never-leak",
  PAYPHONE_STORE_ID: "store-value-must-never-leak",
  PAYPHONE_RESPONSE_URL: "https://demo.example.com/",
};

function configError(env) {
  try {
    loadPaymentsConfig(env);
  } catch (error) {
    assert.ok(error instanceof PaymentsConfigError);
    return error.message;
  }
  assert.fail("expected a configuration error");
}

test("payments are disabled by default so the API starts without PayPhone", () => {
  const config = loadPaymentsConfig({});
  assert.equal(config.mode, "disabled");
  assert.equal(config.payphone, null);
  assert.equal(config.callbackSecret, null);
  // Credentials alone do not switch PayPhone on.
  assert.equal(
    loadPaymentsConfig({ ...PAYPHONE_ENV, PAYMENTS_MODE: undefined }).mode,
    "disabled",
  );
});

test("payphone mode loads credentials and normalizes the callback base URL", () => {
  const config = loadPaymentsConfig(PAYPHONE_ENV);
  assert.equal(config.mode, "payphone");
  assert.deepEqual(config.payphone, {
    token: "token-value-must-never-leak",
    storeId: "store-value-must-never-leak",
  });
  assert.equal(config.responseBaseUrl, "https://demo.example.com");
  assert.equal(config.callbackSecret, SECRET);
  assert.equal(
    loadPaymentsConfig({
      ...PAYPHONE_ENV,
      PAYPHONE_RESPONSE_URL: "http://localhost:8080/",
    }).responseBaseUrl,
    "http://localhost:8080",
  );
});

test("store id is optional because some PayPhone apps only expose the token", () => {
  for (const storeId of [undefined, "", "   "]) {
    const config = loadPaymentsConfig({
      ...PAYPHONE_ENV,
      PAYPHONE_STORE_ID: storeId,
    });
    assert.deepEqual(config.payphone, {
      token: "token-value-must-never-leak",
      storeId: null,
    });
  }
});

test("missing payphone variables are named without exposing any value", () => {
  const message = configError({
    PAYMENTS_MODE: "payphone",
    PAYPHONE_STORE_ID: "store-value-must-never-leak",
  });
  for (const name of [
    "PAYMENTS_CALLBACK_SECRET",
    "PAYPHONE_RESPONSE_URL",
    "PAYPHONE_TOKEN",
  ]) {
    assert.match(message, new RegExp(name));
  }
  assert.doesNotMatch(message, /PAYPHONE_STORE_ID/);
  assert.doesNotMatch(message, /must-never-leak/);
});

test("weak secrets, insecure URLs and unknown modes are rejected", () => {
  const cases = [
    [{ ...PAYPHONE_ENV, PAYMENTS_CALLBACK_SECRET: "short" }, /at least 32/],
    [
      { ...PAYPHONE_ENV, PAYPHONE_RESPONSE_URL: "http://demo.example.com" },
      /https/,
    ],
    [
      { ...PAYPHONE_ENV, PAYPHONE_RESPONSE_URL: "https://x.test/?a=1" },
      /query/,
    ],
    [{ ...PAYPHONE_ENV, PAYPHONE_RESPONSE_URL: "not a url" }, /valid URL/],
    [{ PAYMENTS_MODE: "paypal" }, /PAYMENTS_MODE/],
    [
      { PAYMENTS_MODE: "simulated", PAYMENTS_SIMULATED_OUTCOME: "maybe" },
      /OUTCOME/,
    ],
  ];
  for (const [env, expected] of cases) {
    const message = configError(env);
    assert.match(message, expected);
    assert.doesNotMatch(message, /must-never-leak|short/);
  }
});

test("simulated mode needs the HMAC key and is forbidden in production", () => {
  const config = loadPaymentsConfig({
    PAYMENTS_MODE: "simulated",
    PAYMENTS_SIMULATED_OUTCOME: "rejected",
    PAYMENTS_CALLBACK_SECRET: SECRET,
  });
  assert.equal(config.mode, "simulated");
  assert.equal(config.simulatedOutcome, "rejected");
  assert.equal(config.payphone, null);
  assert.match(
    configError({ PAYMENTS_MODE: "simulated" }),
    /PAYMENTS_CALLBACK_SECRET is required/,
  );
  assert.match(
    configError({
      PAYMENTS_MODE: "simulated",
      PAYMENTS_CALLBACK_SECRET: SECRET,
      NODE_ENV: "production",
    }),
    /not allowed in production/,
  );
});

function decide(context) {
  return decideApprovedPayment({
    reservationsActive: false,
    stockAvailable: false,
    alreadyApplied: false,
    ...context,
  });
}

test("approved payment on time consumes the reservation and confirms", () => {
  assert.deepEqual(
    decide({ orderStatus: "pending_payment", reservationsActive: true }),
    {
      orderStatus: "confirmed",
      paymentStatus: "approved",
      stock: "consume_reservation",
      reason: "reserved_stock",
    },
  );
});

test("late payment confirms only while the stock is still free", () => {
  for (const orderStatus of ["expired", "pending_payment"]) {
    assert.deepEqual(
      decide({ orderStatus, stockAvailable: true }),
      {
        orderStatus: "confirmed",
        paymentStatus: "approved",
        stock: "take_available",
        reason: "late_payment_stock_available",
      },
      orderStatus,
    );
  }
});

test("late payment for stock sold to someone else goes to review, never confirmed", () => {
  // 10:00 order reserves the last unit; 10:05 reservation expires;
  // 10:06 another buyer takes it; 10:07 the first payment is approved.
  for (const orderStatus of ["expired", "pending_payment"]) {
    assert.deepEqual(
      decide({ orderStatus, stockAvailable: false }),
      {
        orderStatus: "review_required",
        paymentStatus: "review_required",
        stock: "none",
        reason: "late_payment_stock_unavailable",
      },
      orderStatus,
    );
  }
});

test("a repeated notice of the same payment changes nothing", () => {
  assert.deepEqual(decide({ orderStatus: "confirmed", alreadyApplied: true }), {
    orderStatus: null,
    paymentStatus: "approved",
    stock: "none",
    reason: "already_confirmed",
  });
});

test("a second payment for an already paid order is flagged as a double charge", () => {
  // Payment A confirmed the order; payment B (a retry) is also approved.
  for (const reservationsActive of [true, false]) {
    for (const stockAvailable of [true, false]) {
      assert.deepEqual(
        decide({
          orderStatus: "confirmed",
          reservationsActive,
          stockAvailable,
          alreadyApplied: false,
        }),
        {
          orderStatus: null,
          paymentStatus: "review_required",
          stock: "none",
          reason: "order_already_paid",
        },
      );
    }
  }
});

test("canceled or reviewed orders are never confirmed again", () => {
  for (const reservationsActive of [true, false]) {
    for (const stockAvailable of [true, false]) {
      for (const alreadyApplied of [true, false]) {
        const context = { reservationsActive, stockAvailable, alreadyApplied };
        assert.deepEqual(decide({ orderStatus: "canceled", ...context }), {
          orderStatus: null,
          paymentStatus: "review_required",
          stock: "none",
          reason: "order_canceled",
        });
        assert.deepEqual(
          decide({ orderStatus: "review_required", ...context }),
          {
            orderStatus: null,
            paymentStatus: "review_required",
            stock: "none",
            reason: "already_in_review",
          },
        );
      }
    }
  }
});

test("every decision is an allowed transition and never confirms without stock", () => {
  let combinations = 0;
  for (const orderStatus of ORDER_STATUSES) {
    for (const reservationsActive of [true, false]) {
      for (const stockAvailable of [true, false]) {
        for (const alreadyApplied of [true, false]) {
          combinations += 1;
          const decision = decideApprovedPayment({
            orderStatus,
            reservationsActive,
            stockAvailable,
            alreadyApplied,
          });
          const label = `${orderStatus}/${reservationsActive}/${stockAvailable}/${alreadyApplied}`;
          if (decision.orderStatus !== null) {
            assert.ok(canTransition(orderStatus, decision.orderStatus), label);
          }
          if (decision.orderStatus === "confirmed") {
            assert.ok(
              decision.stock === "consume_reservation"
                ? reservationsActive
                : stockAvailable,
              label,
            );
            assert.equal(decision.paymentStatus, "approved", label);
          } else {
            assert.equal(decision.stock, "none", label);
          }
          // Approved without effect only when it is the very same payment.
          if (decision.orderStatus === null) {
            assert.equal(
              decision.paymentStatus === "approved",
              orderStatus === "confirmed" && alreadyApplied,
              label,
            );
          }
        }
      }
    }
  }
  assert.equal(combinations, 40);
});
