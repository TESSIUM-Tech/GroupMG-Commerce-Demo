/** Order figures needed to split the charge, all in USD cents. */
export interface ChargeableOrder {
  items: {
    quantity: number;
    unitPriceMinor: number;
    taxRateBps: number;
    taxMinor: number;
  }[];
  shippingMinor: number;
  shippingTaxRateBps: number;
  shippingTaxMinor: number;
  totalMinor: number;
}

/** PayPhone breakdown: amount = amountWithoutTax + amountWithTax + tax. */
export interface SaleAmounts {
  amountMinor: number;
  amountWithTaxMinor: number;
  amountWithoutTaxMinor: number;
  taxMinor: number;
}

export class InconsistentOrderAmountError extends Error {
  constructor() {
    super("Order amounts do not add up to its total; payment not started");
    this.name = "InconsistentOrderAmountError";
  }
}

/**
 * Splits the persisted order into PayPhone's taxed base, untaxed base and tax.
 * Taxed shipping counts as taxed base (docs/demo-rules.md: no "service").
 * The parts must add up exactly to the order total, or nothing is charged.
 */
export function buildSaleAmounts(order: ChargeableOrder): SaleAmounts {
  let amountWithTaxMinor = 0;
  let amountWithoutTaxMinor = 0;
  let taxMinor = 0;
  for (const item of order.items) {
    const base = item.quantity * item.unitPriceMinor;
    if (item.taxRateBps > 0) amountWithTaxMinor += base;
    else amountWithoutTaxMinor += base;
    taxMinor += item.taxMinor;
  }
  if (order.shippingTaxRateBps > 0) amountWithTaxMinor += order.shippingMinor;
  else amountWithoutTaxMinor += order.shippingMinor;
  taxMinor += order.shippingTaxMinor;

  const amountMinor = amountWithTaxMinor + amountWithoutTaxMinor + taxMinor;
  const parts = [
    amountMinor,
    amountWithTaxMinor,
    amountWithoutTaxMinor,
    taxMinor,
  ];
  if (
    amountMinor !== order.totalMinor ||
    amountMinor <= 0 ||
    parts.some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    throw new InconsistentOrderAmountError();
  }
  return { amountMinor, amountWithTaxMinor, amountWithoutTaxMinor, taxMinor };
}
