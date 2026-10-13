export interface CartItem {
  sku: string;
  color: string;
  quantity: number;
  priceMinor?: number; // Precio unitario conocido al agregar para detectar cambios al revalidar
}

const key = "groupmg-demo-cart";
export const CART_UPDATED_EVENT = "groupmg:cart-updated";

/**
 * Lee el carrito guardado en localStorage.
 * Solo maneja datos del producto (SKU, variante, cantidad, precio orientativo).
 * Nunca almacena datos personales ni credenciales.
 */
export function readCart(): CartItem[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  const raw = localStorage.getItem(key);
  if (!raw) return [];

  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];

    return value.filter(
      (item): item is CartItem =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as CartItem).sku === "string" &&
        (item as CartItem).sku.trim().length > 0 &&
        typeof (item as CartItem).color === "string" &&
        Number.isSafeInteger((item as CartItem).quantity) &&
        (item as CartItem).quantity > 0 &&
        (item as CartItem).quantity <= 99 &&
        ((item as CartItem).priceMinor === undefined ||
          Number.isSafeInteger((item as CartItem).priceMinor)),
    );
  } catch {
    return [];
  }
}

/**
 * Guarda los ítems en localStorage y emite el evento de sincronización en ventana.
 */
export function saveCart(items: CartItem[]) {
  if (typeof window === "undefined" || !window.localStorage) return;

  const sanitized: CartItem[] = items
    .filter(
      (item) =>
        Boolean(item) &&
        typeof item.sku === "string" &&
        item.sku.trim().length > 0 &&
        typeof item.color === "string" &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0,
    )
    .map((item) => ({
      sku: item.sku.trim(),
      color: item.color,
      quantity: Math.min(99, Math.max(1, item.quantity)),
      ...(item.priceMinor !== undefined ? { priceMinor: item.priceMinor } : {}),
    }));

  localStorage.setItem(key, JSON.stringify(sanitized));
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
}

/**
 * Agrega un producto al carrito.
 * Si ya existe con el mismo SKU y color, incrementa la cantidad sin duplicar líneas.
 * Valida cantidad positiva y límites visibles contra el inventario disponible.
 */
export function addCartItem(
  sku: string,
  color: string,
  quantityToAdd = 1,
  maxAvailable?: number,
  knownPriceMinor?: number,
) {
  if (!Number.isSafeInteger(quantityToAdd) || quantityToAdd <= 0) {
    throw new Error("La cantidad debe ser un entero positivo.");
  }

  const items = readCart();
  const normalizedSku = sku.trim();

  // Acumular cantidad total existente para este SKU
  const currentTotalForSku = items
    .filter((entry) => entry.sku === normalizedSku)
    .reduce((sum, entry) => sum + entry.quantity, 0);

  if (maxAvailable !== undefined) {
    if (maxAvailable <= 0) {
      throw new Error("El producto está agotado en el catálogo.");
    }
    if (currentTotalForSku + quantityToAdd > maxAvailable) {
      throw new Error(
        `Disponibilidad insuficiente. Máximo disponible: ${maxAvailable}.`,
      );
    }
  }

  const existing = items.find(
    (item) => item.sku === normalizedSku && item.color === color,
  );

  if (existing) {
    existing.quantity = Math.min(99, existing.quantity + quantityToAdd);
    if (knownPriceMinor !== undefined) {
      existing.priceMinor = knownPriceMinor;
    }
  } else {
    items.push({
      sku: normalizedSku,
      color,
      quantity: Math.min(99, quantityToAdd),
      ...(knownPriceMinor !== undefined ? { priceMinor: knownPriceMinor } : {}),
    });
  }

  saveCart(items);
}

/**
 * Modifica la cantidad de un producto. Si es menor o igual a 0, se elimina.
 */
export function updateCartItemQuantity(
  sku: string,
  color: string,
  newQuantity: number,
  maxAvailable?: number,
) {
  const items = readCart();
  if (newQuantity <= 0) {
    saveCart(
      items.filter((item) => !(item.sku === sku && item.color === color)),
    );
    return;
  }

  const existing = items.find(
    (item) => item.sku === sku && item.color === color,
  );
  if (!existing) return;

  let bounded = Math.min(99, Math.max(1, newQuantity));
  if (maxAvailable !== undefined) {
    bounded = Math.min(bounded, Math.max(1, maxAvailable));
  }

  existing.quantity = bounded;
  saveCart(items);
}

/**
 * Elimina un producto específico del carrito.
 */
export function removeCartItem(sku: string, color: string) {
  const items = readCart();
  saveCart(items.filter((item) => !(item.sku === sku && item.color === color)));
}

/**
 * Vacía el carrito por completo.
 */
export function clearCart() {
  saveCart([]);
}
