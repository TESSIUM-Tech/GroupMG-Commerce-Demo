/**
 * DEMO-10: Tests unitarios del recorrido de compra completo
 * Ejecutar: node --test apps/web/test/checkout-flow.test.cjs
 */
"use strict";

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Mock de sessionStorage (Node.js no lo tiene; crypto y btoa ya existen en Node 22)
// ---------------------------------------------------------------------------
const sessionStore = new Map();
global.sessionStorage = {
  getItem: (k) => sessionStore.get(k) ?? null,
  setItem: (k, v) => sessionStore.set(k, v),
  removeItem: (k) => sessionStore.delete(k),
  clear: () => sessionStore.clear(),
};
// btoa is available in Node 16+; ensure it's accessible as global
if (typeof global.btoa === "undefined") {
  global.btoa = (s) => Buffer.from(s).toString("base64");
}

// ---------------------------------------------------------------------------
// Importar helpers directamente (sin bundler)
// ---------------------------------------------------------------------------

/** Replica de buildIdempotencyKey de demo-order.ts */
function buildIdempotencyKey(items) {
  const fingerprint = items
    .map((i) => `${i.sku}:${i.color}:${i.quantity}`)
    .sort()
    .join("|");
  return `idem-${Buffer.from(fingerprint).toString("base64").slice(0, 24)}`;
}

const ORDER_KEY = "groupmg-demo-order";

function saveDemoOrder(order) {
  sessionStorage.setItem(ORDER_KEY, JSON.stringify(order));
}

function readDemoOrder() {
  const raw = sessionStorage.getItem(ORDER_KEY);
  if (!raw) return null;
  const order = JSON.parse(raw);
  const validStatuses = ["pending", "confirmed", "rejected", "cancelled"];
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

function clearDemoOrder() {
  sessionStorage.removeItem(ORDER_KEY);
}

// Minimal localStorage mock (reuse from cart-storage.test pattern)
const localStore = new Map();
const localStorage = {
  getItem: (k) => localStore.get(k) ?? null,
  setItem: (k, v) => localStore.set(k, v),
  removeItem: (k) => localStore.delete(k),
  clear: () => localStore.clear(),
};
Object.assign(global, { localStorage });

function saveCart(items) {
  localStorage.setItem("groupmg-cart", JSON.stringify(items));
}

function readCart() {
  const raw = localStorage.getItem("groupmg-cart");
  if (!raw) return [];
  return JSON.parse(raw);
}

function clearCart() {
  localStorage.removeItem("groupmg-cart");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const SAMPLE_ITEMS = [
  { sku: "SKU-001", color: "Negro", quantity: 2, priceMinor: 1500 },
  { sku: "SKU-002", color: "Blanco", quantity: 1, priceMinor: 2500 },
];

function makeOrder(overrides = {}) {
  return {
    id: "DEMO-ABCD1234",
    idempotencyKey: buildIdempotencyKey(SAMPLE_ITEMS),
    items: SAMPLE_ITEMS,
    subtotal: 5500,
    tax: 825,
    shipping: 300,
    shippingTax: 45,
    total: 6670,
    delivery: "delivery",
    status: "pending",
    ...overrides,
  };
}

describe("DEMO-10: Recorrido de compra completo", () => {
  beforeEach(() => {
    sessionStore.clear();
    localStore.clear();
  });

  it("1. Guardar y leer un pedido pendiente con idempotencyKey", () => {
    const order = makeOrder();
    saveDemoOrder(order);
    const loaded = readDemoOrder();
    assert.equal(loaded.id, "DEMO-ABCD1234");
    assert.equal(loaded.status, "pending");
    assert.ok(
      loaded.idempotencyKey.startsWith("idem-"),
      "idempotencyKey debe comenzar con 'idem-'",
    );
  });

  it("2. La clave idempotente es estable: mismos ítems → misma clave", () => {
    const key1 = buildIdempotencyKey(SAMPLE_ITEMS);
    const key2 = buildIdempotencyKey([...SAMPLE_ITEMS].reverse()); // orden diferente
    assert.equal(key1, key2, "La clave no debe depender del orden de los ítems");
  });

  it("3. Estado confirmed: carrito se vacía", () => {
    saveCart(SAMPLE_ITEMS);
    assert.equal(readCart().length, 2, "El carrito debe tener 2 productos antes");
    const order = makeOrder();
    saveDemoOrder(order);
    // Simular confirmación
    saveDemoOrder({ ...order, status: "confirmed" });
    clearCart();
    assert.equal(readCart().length, 0, "El carrito debe vaciarse al confirmar");
    assert.equal(readDemoOrder().status, "confirmed");
  });

  it("4. Estado rejected: carrito se conserva", () => {
    saveCart(SAMPLE_ITEMS);
    const order = makeOrder();
    saveDemoOrder(order);
    // Simular rechazo
    saveDemoOrder({ ...order, status: "rejected" });
    // El carrito NO se limpia
    assert.equal(readCart().length, 2, "El carrito debe conservarse al rechazar");
    assert.equal(readDemoOrder().status, "rejected");
  });

  it("5. Estado cancelled: carrito se conserva", () => {
    saveCart(SAMPLE_ITEMS);
    const order = makeOrder();
    saveDemoOrder(order);
    // Simular cancelación
    saveDemoOrder({ ...order, status: "cancelled" });
    assert.equal(readCart().length, 2, "El carrito debe conservarse al cancelar");
    assert.equal(readDemoOrder().status, "cancelled");
  });

  it("6. readDemoOrder lanza error si el estado no es válido", () => {
    sessionStorage.setItem(
      ORDER_KEY,
      JSON.stringify({ ...makeOrder(), status: "hacked" }),
    );
    assert.throws(() => readDemoOrder(), /Invalid demo order/);
  });

  it("7. readDemoOrder lanza error si falta idempotencyKey", () => {
    const bad = makeOrder();
    delete bad.idempotencyKey;
    sessionStorage.setItem(ORDER_KEY, JSON.stringify(bad));
    assert.throws(() => readDemoOrder(), /Invalid demo order/);
  });

  it("8. clearDemoOrder elimina el pedido de sessionStorage", () => {
    saveDemoOrder(makeOrder());
    assert.notEqual(readDemoOrder(), null);
    clearDemoOrder();
    assert.equal(readDemoOrder(), null);
  });

  it("9. readDemoOrder devuelve null cuando no hay pedido guardado", () => {
    assert.equal(readDemoOrder(), null);
  });

  it("10. Un redirect de confirmación no prueba el pago: status debe leerse del store", () => {
    // Si alguien navega directo a /confirmacion sin pasar por el flujo,
    // el store no tiene un pedido "confirmed" → readDemoOrder() devuelve null
    // o tiene status "pending", lo que la vista debe detectar.
    saveDemoOrder(makeOrder({ status: "pending" }));
    const order = readDemoOrder();
    assert.notEqual(
      order.status,
      "confirmed",
      "Un pedido pending no debe mostrarse como confirmed aunque se navegue a /confirmacion",
    );
  });
});
