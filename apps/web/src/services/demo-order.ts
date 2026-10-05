import { products } from "../views/index/data/products";
import type { CartItem } from "./cart-storage";

export interface DemoOrder {
  id: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  shippingTax: number;
  total: number;
  delivery: "pickup" | "delivery";
  status: "pending" | "confirmed";
}
const key = "groupmg-demo-order";
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
  sessionStorage.setItem(key, JSON.stringify(order));
}
export function readDemoOrder(): DemoOrder | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const order = JSON.parse(raw) as DemoOrder;
  if (
    !order ||
    typeof order.id !== "string" ||
    !Array.isArray(order.items) ||
    !Number.isSafeInteger(order.total) ||
    (order.status !== "pending" && order.status !== "confirmed")
  )
    throw new Error("Invalid demo order");
  return order;
}
