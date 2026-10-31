import { products } from "../views/index/data/products";
import type { CartItem } from "./cart-storage";

export type OrderStatus = "pending" | "confirmed" | "rejected" | "cancelled";

export interface DemoOrder {
  id: string;
  /** Idempotency key — reused on retries to prevent double-submission. */
  idempotencyKey: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  shippingTax: number;
  total: number;
  delivery: "pickup" | "delivery";
  status: OrderStatus;
}

const ORDER_KEY = "groupmg-demo-order";

export function calculateOrder(
  items: CartItem[],
  delivery: DemoOrder["delivery"],
) {
  const subtotal = items.reduce(
    (sum, item) =>
      sum +
      (products.find((product) => product.sku === item.sku)?.priceMinor ?? 0) *
        item.quantity,
    0,
  );
  const tax = items.reduce(
    (sum, item) =>
      sum +
      Math.round(
        ((products.find((product) => product.sku === item.sku)?.priceMinor ??
          0) *
          item.quantity *
          1500) /
          10000,
      ),
    0,
  );
  // Presentation-only flat delivery fee. The API must supply authoritative zone rates.
  const shipping = delivery === "delivery" ? 300 : 0;
  const shippingTax = Math.round((shipping * 1500) / 10000);
  return {
    subtotal,
    tax,
    shipping,
    shippingTax,
    total: subtotal + tax + shipping + shippingTax,
  };
}

export function saveDemoOrder(order: DemoOrder) {
  sessionStorage.setItem(ORDER_KEY, JSON.stringify(order));
}

export function readDemoOrder(): DemoOrder | null {
  const raw = sessionStorage.getItem(ORDER_KEY);
  if (!raw) return null;
  const order = JSON.parse(raw) as DemoOrder;
  const validStatuses: OrderStatus[] = [
    "pending",
    "confirmed",
    "rejected",
    "cancelled",
  ];
  if (
    !order ||
    typeof order.id !== "string" ||
    typeof order.idempotencyKey !== "string" ||
    !Array.isArray(order.items) ||
    !Number.isSafeInteger(order.total) ||
    !validStatuses.includes(order.status)
  )
    throw new Error("Invalid demo order");
  return order;
}

/** Remove the order from sessionStorage (e.g. after confirmed checkout). */
export function clearDemoOrder() {
  sessionStorage.removeItem(ORDER_KEY);
}

/** Generate a stable idempotency key tied to the cart snapshot. */
export function buildIdempotencyKey(items: CartItem[]): string {
  const fingerprint = items
    .map((i) => `${i.sku}:${i.color}:${i.quantity}`)
    .sort()
    .join("|");
  return `idem-${btoa(fingerprint).slice(0, 24)}`;
}
