/**
 * DEMO-15: Validación automatizada del recorrido completo de compra y fallos
 * de integración mediante dobles deterministas para CI.
 * Cubre:
 *   1. Catálogo -> Carrito -> Pedido -> Pago -> Confirmación -> Outbox -> Worker -> ERP
 *   2. Pago rechazado y liberación de reservas
 *   3. Webhook duplicado e idempotencia
 *   4. Control de concurrencia y sobreventa (última unidad)
 *   5. Fallo/Timeout de ERP y reintentos
 *   6. Reentrega de eventos y deduplicación en el consumidor
 *   7. Mensajes corruptos y enrutamiento a Dead Letter Queue (DLQ)
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHmac, createHash } = require("node:crypto");

// ---------------------------------------------------------------------------
// 1. Dobles deterministas de dominio
// ---------------------------------------------------------------------------

function makeTestProduct(overrides = {}) {
  return {
    id: randomUUID(),
    sku: "MG-DEMO-001",
    name: "Smartphone Pro",
    priceMinor: 49900, // 499.00 USD
    currency: "USD",
    taxRateBps: 1500, // 15%
    onHand: 10,
    reserved: 0,
    ...overrides,
  };
}

class DeterministicCommerceStore {
  constructor() {
    this.products = new Map();
    this.orders = new Map();
    this.reservations = new Map();
    this.payments = new Map();
    this.webhookReceipts = new Set();
    this.outbox = [];
    this.erpExports = new Map();
    this.erpSales = new Map();
    this.dlq = [];
  }

  seedProduct(p) {
    this.products.set(p.sku, { ...p });
  }

  // Catálogo
  getCatalogProduct(sku) {
    const p = this.products.get(sku);
    if (!p) return null;
    const available = Math.max(0, p.onHand - p.reserved);
    return {
      sku: p.sku,
      name: p.name,
      priceMinor: p.priceMinor,
      currency: p.currency,
      availableQuantity: available,
      inStock: available > 0,
    };
  }

  // Pedidos
  createOrder({ sku, quantity, customer, idempotencyKey }) {
    const p = this.products.get(sku);
    if (!p) throw new Error("Producto no encontrado");
    const available = p.onHand - p.reserved;
    if (available < quantity) {
      const err = new Error("Stock insuficiente");
      err.code = 409;
      throw err;
    }

    // Reserva concurrente
    p.reserved += quantity;

    const subtotalMinor = p.priceMinor * quantity;
    const taxMinor = Math.round((subtotalMinor * p.taxRateBps) / 10000);
    const totalMinor = subtotalMinor + taxMinor;

    const orderId = randomUUID();
    const order = {
      id: orderId,
      customerId: randomUUID(),
      status: "pending_payment",
      currency: "USD",
      subtotalMinor,
      taxMinor,
      totalMinor,
      idempotencyKey,
      items: [{ sku, quantity, priceMinor: p.priceMinor, taxMinor }],
      customer,
      reservationExpiresAt: new Date(Date.now() + 300_000),
    };

    this.orders.set(orderId, order);
    this.reservations.set(orderId, {
      orderId,
      sku,
      quantity,
      status: "active",
    });

    return order;
  }

  // Pagos y liquidación
  processPaymentCallback({
    orderId,
    transactionId,
    clientTransactionId,
    outcome,
    signature,
    secret,
  }) {
    // Validar firma HMAC
    const expectedSig = createHmac("sha256", secret)
      .update(clientTransactionId)
      .digest("base64url");
    if (signature !== expectedSig) {
      const err = new Error("Firma inválida");
      err.code = 401;
      throw err;
    }

    // Deduplicación de webhook
    const eventKey = `${transactionId}:${outcome}`;
    if (this.webhookReceipts.has(eventKey)) {
      return { kind: "duplicate", orderId };
    }
    this.webhookReceipts.add(eventKey);

    const order = this.orders.get(orderId);
    if (!order) throw new Error("Pedido no encontrado");

    const reservation = this.reservations.get(orderId);
    const p = this.products.get(reservation.sku);

    if (outcome === "approved") {
      // Consumir reserva y confirmar
      reservation.status = "consumed";
      p.onHand -= reservation.quantity;
      p.reserved -= reservation.quantity;
      order.status = "confirmed";

      const eventId = randomUUID();
      const event = {
        eventId,
        type: "order.confirmed.v1",
        orderId: order.id,
        occurredAt: new Date().toISOString(),
        data: {
          orderId: order.id,
          currency: order.currency,
          totalMinor: order.totalMinor,
          items: order.items,
        },
      };
      this.outbox.push(event);

      return { kind: "confirmed", orderId, eventId };
    } else {
      // Rechazado / Cancelado: liberar reserva
      reservation.status = "released";
      p.reserved -= reservation.quantity;
      order.status = "canceled";
      return { kind: "rejected", orderId };
    }
  }

  // Worker ERP export
  consumeSaleEvent(event, failErpTimes = 0) {
    if (!event || !event.eventId || !event.data || !event.data.orderId) {
      this.dlq.push({ event, reason: "invalid_contract" });
      return { action: "dlq", reason: "invalid_contract" };
    }

    const { eventId, data } = event;
    const { orderId } = data;

    // Deduplicación en worker
    if (this.erpExports.has(eventId)) {
      return { action: "ack", reason: "already_exported" };
    }

    // Simulación de timeout / caída en ERP
    if (failErpTimes > 0) {
      return { action: "retry", reason: "erp_timeout" };
    }

    // Éxito en ERP
    const erpReference = `ERP-SALE-${randomUUID().slice(0, 8)}`;
    this.erpExports.set(eventId, {
      eventId,
      orderId,
      status: "exported",
      erpReference,
    });
    this.erpSales.set(orderId, erpReference);

    return { action: "ack", reason: `exported: ${erpReference}` };
  }
}

// ---------------------------------------------------------------------------
// 2. Suites de pruebas DEMO-15
// ---------------------------------------------------------------------------

describe("DEMO-15: Recorrido completo y fallos de integración", () => {
  const SECRET = "secret-hmac-key-for-sandbox-tests-32chars";

  test("1. Recorrido completo feliz: Catálogo -> Carrito -> Pedido -> Pago -> Outbox -> Worker -> ERP", () => {
    const store = new DeterministicCommerceStore();
    store.seedProduct(makeTestProduct({ sku: "MG-DEMO-001", onHand: 10 }));

    // 1.1 Catálogo
    const catalogItem = store.getCatalogProduct("MG-DEMO-001");
    assert.equal(catalogItem.availableQuantity, 10);
    assert.equal(catalogItem.inStock, true);

    // 1.2 Carrito (simulación cliente)
    const cart = [{ sku: "MG-DEMO-001", quantity: 2 }];
    assert.ok(cart[0].quantity <= catalogItem.availableQuantity);

    // 1.3 Pedido con reserva de stock
    const order = store.createOrder({
      sku: "MG-DEMO-001",
      quantity: 2,
      customer: {
        firstName: "María",
        lastName: "Demo",
        email: "maria@example.com",
        phone: "0991234567",
      },
      idempotencyKey: "idem-happy-path-001",
    });

    assert.equal(order.status, "pending_payment");
    assert.equal(order.totalMinor, 114770); // 499.00 * 2 = 998.00 + 15% IVA (149.70) = 1147.70 USD

    // El catálogo descuenta la reserva activa
    const updatedCatalog = store.getCatalogProduct("MG-DEMO-001");
    assert.equal(updatedCatalog.availableQuantity, 8);

    // 1.4 Pago Sandbox aprobado con firma HMAC válida
    const clientTransactionId = randomUUID();
    const signature = createHmac("sha256", SECRET)
      .update(clientTransactionId)
      .digest("base64url");

    const paymentResult = store.processPaymentCallback({
      orderId: order.id,
      transactionId: "pay-tx-1001",
      clientTransactionId,
      outcome: "approved",
      signature,
      secret: SECRET,
    });

    assert.equal(paymentResult.kind, "confirmed");
    assert.equal(store.orders.get(order.id).status, "confirmed");
    assert.equal(store.outbox.length, 1);

    // 1.5 Worker consume y exporta la venta al ERP
    const outboxEvent = store.outbox[0];
    const workerResult = store.consumeSaleEvent(outboxEvent);

    assert.equal(workerResult.action, "ack");
    assert.ok(workerResult.reason.startsWith("exported:"));
    assert.ok(store.erpSales.has(order.id));
  });

  test("2. Pago rechazado: pedido se cancela y reserva de stock se libera", () => {
    const store = new DeterministicCommerceStore();
    store.seedProduct(makeTestProduct({ sku: "MG-DEMO-001", onHand: 5 }));

    const order = store.createOrder({
      sku: "MG-DEMO-001",
      quantity: 2,
      customer: { phone: "0991234567" },
      idempotencyKey: "idem-reject-001",
    });

    assert.equal(store.getCatalogProduct("MG-DEMO-001").availableQuantity, 3);

    // Pago rechazado (ej. fondos insuficientes o cancelado por usuario)
    const clientTxId = randomUUID();
    const sig = createHmac("sha256", SECRET)
      .update(clientTxId)
      .digest("base64url");

    const res = store.processPaymentCallback({
      orderId: order.id,
      transactionId: "pay-tx-reject",
      clientTransactionId: clientTxId,
      outcome: "rejected",
      signature: sig,
      secret: SECRET,
    });

    assert.equal(res.kind, "rejected");
    assert.equal(store.orders.get(order.id).status, "canceled");
    // Stock liberado de regreso al catálogo
    assert.equal(store.getCatalogProduct("MG-DEMO-001").availableQuantity, 5);
    // Ningún evento outbox emitido
    assert.equal(store.outbox.length, 0);
  });

  test("3. Webhook duplicado: respuesta idempotente sin confirmación duplicada", () => {
    const store = new DeterministicCommerceStore();
    store.seedProduct(makeTestProduct({ sku: "MG-DEMO-001", onHand: 10 }));

    const order = store.createOrder({
      sku: "MG-DEMO-001",
      quantity: 1,
      customer: { phone: "0991234567" },
      idempotencyKey: "idem-dup-001",
    });

    const clientTxId = randomUUID();
    const sig = createHmac("sha256", SECRET)
      .update(clientTxId)
      .digest("base64url");

    // Primera recepción del webhook
    const res1 = store.processPaymentCallback({
      orderId: order.id,
      transactionId: "pay-tx-2001",
      clientTransactionId: clientTxId,
      outcome: "approved",
      signature: sig,
      secret: SECRET,
    });
    assert.equal(res1.kind, "confirmed");
    assert.equal(store.outbox.length, 1);

    // Segunda recepción del mismo webhook (mismo transactionId y resultado)
    const res2 = store.processPaymentCallback({
      orderId: order.id,
      transactionId: "pay-tx-2001",
      clientTransactionId: clientTxId,
      outcome: "approved",
      signature: sig,
      secret: SECRET,
    });
    assert.equal(res2.kind, "duplicate");
    // No se genera un segundo evento outbox
    assert.equal(store.outbox.length, 1);
  });

  test("4. Stock concurrente: dos compras de la última unidad evitan sobreventa", () => {
    const store = new DeterministicCommerceStore();
    store.seedProduct(makeTestProduct({ sku: "MG-DEMO-001", onHand: 1 }));

    // Cliente 1 reserva la última unidad
    const order1 = store.createOrder({
      sku: "MG-DEMO-001",
      quantity: 1,
      customer: { phone: "0991111111" },
      idempotencyKey: "idem-race-1",
    });
    assert.equal(order1.status, "pending_payment");
    assert.equal(store.getCatalogProduct("MG-DEMO-001").availableQuantity, 0);

    // Cliente 2 intenta reservar la misma unidad simultáneamente
    assert.throws(
      () => {
        store.createOrder({
          sku: "MG-DEMO-001",
          quantity: 1,
          customer: { phone: "0992222222" },
          idempotencyKey: "idem-race-2",
        });
      },
      (err) => err.code === 409,
    );
  });

  test("5. Timeout en ERP: el worker no descarta el mensaje y solicita reintento", () => {
    const store = new DeterministicCommerceStore();
    const event = {
      eventId: randomUUID(),
      data: { orderId: randomUUID() },
    };

    // ERP temporalmente inaccesible
    const result = store.consumeSaleEvent(event, 1);
    assert.equal(result.action, "retry");
    assert.equal(result.reason, "erp_timeout");
    // No se registró en el ERP aún
    assert.equal(store.erpExports.has(event.eventId), false);
  });

  test("6. Reentrega de evento en RabbitMQ: worker deduplica sin duplicar venta ERP", () => {
    const store = new DeterministicCommerceStore();
    const event = {
      eventId: randomUUID(),
      data: { orderId: randomUUID() },
    };

    // Primera entrega: éxito
    const firstDelivery = store.consumeSaleEvent(event);
    assert.equal(firstDelivery.action, "ack");
    assert.ok(firstDelivery.reason.startsWith("exported:"));

    // Segunda entrega (reentrega por red): deduplicación inmediata
    const redelivery = store.consumeSaleEvent(event);
    assert.equal(redelivery.action, "ack");
    assert.equal(redelivery.reason, "already_exported");
  });

  test("7. Evento inválido: enrutamiento automático a Dead Letter Queue (DLQ)", () => {
    const store = new DeterministicCommerceStore();
    const malformedEvent = {
      eventId: null, // Malformado
      data: {},
    };

    const result = store.consumeSaleEvent(malformedEvent);
    assert.equal(result.action, "dlq");
    assert.equal(store.dlq.length, 1);
    assert.equal(store.dlq[0].reason, "invalid_contract");
  });
});
