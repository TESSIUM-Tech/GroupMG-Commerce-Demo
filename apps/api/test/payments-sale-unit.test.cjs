const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSaleAmounts,
  InconsistentOrderAmountError,
} = require("../dist/modules/payments/domain/sale-amounts");
const {
  toPayPhoneNumber,
} = require("../dist/modules/payments/domain/payphone-phone");
const { priceOrder } = require("../dist/modules/orders/domain/order-pricing");

function item(quantity, unitPriceMinor, taxRateBps, taxMinor) {
  return { quantity, unitPriceMinor, taxRateBps, taxMinor };
}

test("pickup order with taxed products: base, VAT and total", () => {
  assert.deepEqual(
    buildSaleAmounts({
      items: [item(3, 1000, 1500, 450)],
      shippingMinor: 0,
      shippingTaxRateBps: 0,
      shippingTaxMinor: 0,
      totalMinor: 3450,
    }),
    {
      amountMinor: 3450,
      amountWithTaxMinor: 3000,
      amountWithoutTaxMinor: 0,
      taxMinor: 450,
    },
  );
});

test("mixed 15 % and 0 % products with taxed courier shipping", () => {
  assert.deepEqual(
    buildSaleAmounts({
      items: [item(2, 850, 1500, 255), item(1, 500, 0, 0)],
      shippingMinor: 300,
      shippingTaxRateBps: 1500,
      shippingTaxMinor: 45,
      totalMinor: 1700 + 255 + 500 + 300 + 45,
    }),
    {
      amountMinor: 2800,
      amountWithTaxMinor: 2000,
      amountWithoutTaxMinor: 500,
      taxMinor: 300,
    },
  );
});

test("untaxed shipping counts as untaxed base", () => {
  const amounts = buildSaleAmounts({
    items: [item(1, 1000, 1500, 150)],
    shippingMinor: 300,
    shippingTaxRateBps: 0,
    shippingTaxMinor: 0,
    totalMinor: 1450,
  });
  assert.equal(amounts.amountWithTaxMinor, 1000);
  assert.equal(amounts.amountWithoutTaxMinor, 300);
  assert.equal(amounts.taxMinor, 150);
});

test("nothing is charged when the parts do not add up to the order total", () => {
  for (const totalMinor of [3449, 3451, 0]) {
    assert.throws(
      () =>
        buildSaleAmounts({
          items: [item(3, 1000, 1500, 450)],
          shippingMinor: 0,
          shippingTaxRateBps: 0,
          shippingTaxMinor: 0,
          totalMinor,
        }),
      InconsistentOrderAmountError,
    );
  }
  assert.throws(
    () =>
      buildSaleAmounts({
        items: [],
        shippingMinor: 0,
        shippingTaxRateBps: 0,
        shippingTaxMinor: 0,
        totalMinor: 0,
      }),
    InconsistentOrderAmountError,
  );
});

test("every order priced by the API splits exactly into PayPhone amounts", () => {
  // Deterministic pseudo-random orders (LCG) so failures are reproducible.
  let seed = 20261010;
  const next = (max) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
  for (let run = 0; run < 200; run += 1) {
    const lines = Array.from({ length: 1 + next(5) }, (_, i) => ({
      product: {
        sku: `SKU-${i}`,
        priceMinor: 1 + next(50000),
        taxRateBps: [0, 1200, 1500][next(3)],
      },
      quantity: 1 + next(99),
    }));
    const shipping =
      next(2) === 0
        ? null
        : { amountMinor: next(2000), taxRateBps: [0, 1500][next(2)] };
    const totals = priceOrder(lines, shipping);
    const amounts = buildSaleAmounts({
      items: totals.lines,
      shippingMinor: totals.shippingMinor,
      shippingTaxRateBps: shipping?.taxRateBps ?? 0,
      shippingTaxMinor: totals.shippingTaxMinor,
      totalMinor: totals.totalMinor,
    });
    assert.equal(amounts.amountMinor, totals.totalMinor, `run ${run}`);
    assert.equal(
      amounts.amountMinor,
      amounts.amountWithTaxMinor +
        amounts.amountWithoutTaxMinor +
        amounts.taxMinor,
      `run ${run}`,
    );
    assert.equal(
      amounts.taxMinor,
      totals.taxMinor + totals.shippingTaxMinor,
      `run ${run}`,
    );
  }
});

test("Ecuadorian mobiles are normalized to 593 plus 9 digits without the 0", () => {
  for (const input of [
    "0991234567",
    "991234567",
    "+593991234567",
    "593991234567",
    "00593991234567",
    "+593 99 123 4567",
    " 099-123-4567 ",
    "(099) 123.4567",
  ]) {
    assert.deepEqual(
      toPayPhoneNumber(input),
      { countryCode: "593", phoneNumber: "991234567" },
      input,
    );
  }
});

test("landlines, other countries and malformed numbers are rejected", () => {
  for (const input of [
    "",
    "022345678",
    "+59322345678",
    "+573001234567",
    "09912345678",
    "09912345",
    "99123456a",
    "+593+991234567",
    "0981234567x",
    "1991234567",
  ]) {
    assert.equal(toPayPhoneNumber(input), null, input);
  }
});
