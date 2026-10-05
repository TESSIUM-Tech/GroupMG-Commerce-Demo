import { products } from "../views/index/data/products";
export interface CartItem {
  sku: string;
  color: string;
  quantity: number;
}
const key = "groupmg-demo-cart";
export const CART_UPDATED_EVENT = "groupmg:cart-updated";

export function readCart(): CartItem[] {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(value)) throw new Error("Invalid cart");
  const items = value.filter(
    (item): item is CartItem =>
      item &&
      typeof item.sku === "string" &&
      typeof item.color === "string" &&
      Number.isSafeInteger(item.quantity) &&
      item.quantity > 0 &&
      item.quantity <= 99,
  );
  if (items.length !== value.length) throw new Error("Invalid cart items");
  return items;
}

export function saveCart(items: CartItem[]) {
  localStorage.setItem(key, JSON.stringify(items));
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
}
export function addCartItem(sku: string, color: string) {
  const items = readCart();
  const product = products.find((item) => item.sku === sku);
  const quantity = items
    .filter((item) => item.sku === sku)
    .reduce((sum, item) => sum + item.quantity, 0);
  if (!product || quantity >= product.stock)
    throw new Error("Demo stock unavailable");
  const existing = items.find(
    (item) => item.sku === sku && item.color === color,
  );
  if (existing) existing.quantity = Math.min(99, existing.quantity + 1);
  else items.push({ sku, color, quantity: 1 });
  saveCart(items);
}
