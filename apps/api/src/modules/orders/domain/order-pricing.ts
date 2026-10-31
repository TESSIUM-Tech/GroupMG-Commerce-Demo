import { OrderAmountOutOfRangeError } from "./order-errors";

/** PostgreSQL INTEGER upper bound used by every *Minor column. */
const MAX_MINOR = 2_147_483_647;

export interface PricedProduct {
  sku: string;
  priceMinor: number;
  taxRateBps: number;
}

export interface PricedLine {
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
}

export interface ShippingCharge {
  amountMinor: number;
  taxRateBps: number;
}

export interface OrderTotals {
  lines: PricedLine[];
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  shippingTaxMinor: number;
  totalMinor: number;
}

/** Tax rounded to the cent, half up; same formula as the item_money CHECK. */
export function taxFor(baseMinor: number, taxRateBps: number): number {
  return Math.floor((baseMinor * taxRateBps + 5000) / 10000);
}

function checked(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR) {
    throw new OrderAmountOutOfRangeError();
  }
  return value;
}

/** Prices every line from trusted product data; never from client input. */
export function priceOrder(
  lines: { product: PricedProduct; quantity: number }[],
  shipping: ShippingCharge | null,
): OrderTotals {
  const priced = lines.map(({ product, quantity }) => {
    const base = checked(product.priceMinor * quantity);
    const taxMinor = checked(taxFor(base, product.taxRateBps));
    return {
      sku: product.sku,
      quantity,
      unitPriceMinor: product.priceMinor,
      taxRateBps: product.taxRateBps,
      taxMinor,
      totalMinor: checked(base + taxMinor),
    };
  });
  const subtotalMinor = checked(
    priced.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0),
  );
  const taxMinor = checked(
    priced.reduce((sum, line) => sum + line.taxMinor, 0),
  );
  const shippingMinor = checked(shipping?.amountMinor ?? 0);
  const shippingTaxMinor = checked(
    shipping ? taxFor(shippingMinor, shipping.taxRateBps) : 0,
  );
  return {
    lines: priced,
    subtotalMinor,
    taxMinor,
    shippingMinor,
    shippingTaxMinor,
    totalMinor: checked(
      subtotalMinor + taxMinor + shippingMinor + shippingTaxMinor,
    ),
  };
}
