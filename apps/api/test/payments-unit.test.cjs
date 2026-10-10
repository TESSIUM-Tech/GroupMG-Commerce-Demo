const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  decideApprovedPayment,
} = require("../dist/modules/payments/domain/approved-payment-policy");
const {
  ORDER_STATUSES,
  canTransition,
} = require("../dist/modules/orders/domain/order-status");

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
