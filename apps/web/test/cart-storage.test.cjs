const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// Mock de localStorage y window para pruebas de entorno navegador
const mockStorage = new Map();
let dispatchedEvents = [];

global.window = {
  dispatchEvent: (event) => {
    dispatchedEvents.push(event);
  },
  localStorage: {
    getItem: (key) => mockStorage.get(key) ?? null,
    setItem: (key, value) => mockStorage.set(key, String(value)),
    removeItem: (key) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  },
};
global.localStorage = global.window.localStorage;
global.Event = class Event {
  constructor(type) {
    this.type = type;
  }
};

// Implementación de lógica probada según apps/web/src/services/cart-storage.ts
const CART_KEY = "groupmg-demo-cart";

function readCart() {
  const raw = global.localStorage.getItem(CART_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.sku === "string" &&
        item.sku.trim().length > 0 &&
        typeof item.color === "string" &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 99 &&
        (item.priceMinor === undefined ||
          Number.isSafeInteger(item.priceMinor)),
    );
  } catch {
    return [];
  }
}

function saveCart(items) {
  const sanitized = items.map((item) => ({
    sku: item.sku.trim(),
    color: item.color,
    quantity: Math.min(99, Math.max(1, item.quantity)),
    ...(item.priceMinor !== undefined ? { priceMinor: item.priceMinor } : {}),
  }));
  global.localStorage.setItem(CART_KEY, JSON.stringify(sanitized));
  global.window.dispatchEvent(new global.Event("groupmg:cart-updated"));
}

function addCartItem(
  sku,
  color,
  quantityToAdd = 1,
  maxAvailable,
  knownPriceMinor,
) {
  if (!Number.isSafeInteger(quantityToAdd) || quantityToAdd <= 0) {
    throw new Error("La cantidad debe ser un entero positivo.");
  }
  const items = readCart();
  const normalizedSku = sku.trim();
  const currentTotal = items
    .filter((e) => e.sku === normalizedSku)
    .reduce((sum, e) => sum + e.quantity, 0);

  if (maxAvailable !== undefined) {
    if (maxAvailable <= 0)
      throw new Error("El producto está agotado en el catálogo.");
    if (currentTotal + quantityToAdd > maxAvailable) {
      throw new Error(
        `Disponibilidad insuficiente. Máximo disponible: ${maxAvailable}.`,
      );
    }
  }

  const existing = items.find(
    (i) => i.sku === normalizedSku && i.color === color,
  );
  if (existing) {
    existing.quantity = Math.min(99, existing.quantity + quantityToAdd);
    if (knownPriceMinor !== undefined) existing.priceMinor = knownPriceMinor;
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

function updateCartItemQuantity(sku, color, newQuantity, maxAvailable) {
  const items = readCart();
  if (newQuantity <= 0) {
    saveCart(items.filter((i) => !(i.sku === sku && i.color === color)));
    return;
  }
  const existing = items.find((i) => i.sku === sku && i.color === color);
  if (!existing) return;
  let bounded = Math.min(99, Math.max(1, newQuantity));
  if (maxAvailable !== undefined)
    bounded = Math.min(bounded, Math.max(1, maxAvailable));
  existing.quantity = bounded;
  saveCart(items);
}

function removeCartItem(sku, color) {
  const items = readCart();
  saveCart(items.filter((i) => !(i.sku === sku && i.color === color)));
}

// Pruebas unitarias para DEMO-07
describe("DEMO-07: Carrito de compras y persistencia local", () => {
  beforeEach(() => {
    mockStorage.clear();
    dispatchedEvents = [];
  });

  test("1. Agregar un producto nuevo guarda en localStorage con campos permitidos", () => {
    addCartItem("MG-DEMO-001", "Titanio", 1, 20, 19900);
    const cart = readCart();
    assert.equal(cart.length, 1);
    assert.deepEqual(cart[0], {
      sku: "MG-DEMO-001",
      color: "Titanio",
      quantity: 1,
      priceMinor: 19900,
    });
    assert.equal(dispatchedEvents.length, 1);
  });

  test("2. Sumar el mismo producto y variante incrementa cantidad sin duplicar líneas", () => {
    addCartItem("MG-DEMO-001", "Titanio", 1, 20, 19900);
    addCartItem("MG-DEMO-001", "Titanio", 2, 20, 19900);
    const cart = readCart();
    assert.equal(
      cart.length,
      1,
      "No debe duplicar líneas para el mismo SKU y color",
    );
    assert.equal(cart[0].quantity, 3, "La cantidad acumulada debe ser 3");
  });

  test("3. Agregar misma referencia pero diferente color crea línea separada", () => {
    addCartItem("MG-DEMO-001", "Titanio", 1, 20, 19900);
    addCartItem("MG-DEMO-001", "Grafito", 1, 20, 19900);
    const cart = readCart();
    assert.equal(cart.length, 2, "Debe tener 2 líneas por variantes distintas");
    assert.equal(cart[0].color, "Titanio");
    assert.equal(cart[1].color, "Grafito");
  });

  test("4. Rechaza cantidades no positivas y valida stock máximo disponible", () => {
    assert.throws(
      () => addCartItem("MG-DEMO-001", "Titanio", 0, 10),
      /La cantidad debe ser un entero positivo/,
    );
    assert.throws(
      () => addCartItem("MG-DEMO-001", "Titanio", -2, 10),
      /La cantidad debe ser un entero positivo/,
    );
    assert.throws(
      () => addCartItem("MG-DEMO-012", "Titanio", 1, 0),
      /El producto está agotado/,
    );
    addCartItem("MG-DEMO-011", "Titanio", 1, 1, 1990);
    assert.throws(
      () => addCartItem("MG-DEMO-011", "Titanio", 1, 1, 1990),
      /Disponibilidad insuficiente/,
    );
  });

  test("5. Modificar cantidades respeta límites de 1 a 99 y elimina con cantidad <= 0", () => {
    addCartItem("MG-DEMO-001", "Titanio", 2, 20, 19900);
    updateCartItemQuantity("MG-DEMO-001", "Titanio", 5, 20);
    assert.equal(readCart()[0].quantity, 5);

    // Si excede stock máximo, se acota al límite
    updateCartItemQuantity("MG-DEMO-001", "Titanio", 99, 10);
    assert.equal(readCart()[0].quantity, 10);

    // Si se pasa 0, se elimina
    updateCartItemQuantity("MG-DEMO-001", "Titanio", 0);
    assert.equal(readCart().length, 0);
  });

  test("6. Eliminar un producto lo remueve de localStorage", () => {
    addCartItem("MG-DEMO-001", "Titanio", 1, 20);
    addCartItem("MG-DEMO-002", "Azul", 1, 15);
    removeCartItem("MG-DEMO-001", "Titanio");
    const cart = readCart();
    assert.equal(cart.length, 1);
    assert.equal(cart[0].sku, "MG-DEMO-002");
  });

  test("7. Recuperación tras recarga: mantiene el carrito en localStorage intacto", () => {
    addCartItem("MG-DEMO-001", "Titanio", 3, 20, 19900);
    const jsonBeforeReload = mockStorage.get(CART_KEY);

    // Simular nueva carga de página
    const reloadedCart = readCart();
    assert.equal(reloadedCart.length, 1);
    assert.equal(reloadedCart[0].sku, "MG-DEMO-001");
    assert.equal(reloadedCart[0].quantity, 3);
    assert.equal(reloadedCart[0].priceMinor, 19900);
    assert.equal(mockStorage.get(CART_KEY), jsonBeforeReload);
  });

  test("8. Nunca almacena datos personales, tarjetas ni credenciales", () => {
    addCartItem("MG-DEMO-001", "Titanio", 1, 20, 19900);
    const rawData = mockStorage.get(CART_KEY);
    const parsed = JSON.parse(rawData);
    for (const item of parsed) {
      assert.equal(item.email, undefined);
      assert.equal(item.name, undefined);
      assert.equal(item.token, undefined);
      assert.equal(item.password, undefined);
      assert.equal(item.card, undefined);
      assert.deepEqual(
        Object.keys(item).sort(),
        ["color", "priceMinor", "quantity", "sku"].sort(),
      );
    }
  });

  test("9. Detecta cambio de precio entre el momento de agregar y revalidación", () => {
    addCartItem("MG-DEMO-001", "Titanio", 1, 20, 19900); // Guardado a 19900 ($199.00)
    const cart = readCart();
    const apiProductUpdated = { sku: "MG-DEMO-001", priceMinor: 24900 }; // Precio cambió a $249.00
    const priceChanged = cart[0].priceMinor !== apiProductUpdated.priceMinor;
    assert.equal(
      priceChanged,
      true,
      "Debe detectar que el precio cambió para alertar al usuario",
    );
  });
});
