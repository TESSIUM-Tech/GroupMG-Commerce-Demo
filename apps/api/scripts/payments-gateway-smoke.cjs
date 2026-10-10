/**
 * DEMO-09 smoke test through APISIX (docs/payments.md).
 * Requires: docker compose --profile app up with PAYMENTS_MODE=simulated, the
 * demo seed loaded and PAYMENTS_CALLBACK_SECRET in .env (shared with the API).
 * Usage: node apps/api/scripts/payments-gateway-smoke.cjs [http://localhost:8080]
 * Creates one demo order (uses one unit of MG-DEMO-001) in the local demo DB.
 */
const { createHmac, randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const gateway = (process.argv[2] ?? "http://localhost:8080").replace(
  /\/+$/,
  "",
);
const api = `${gateway}/api/v1`;
const secret = process.env.PAYMENTS_CALLBACK_SECRET;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

function callbackUrl(signature, transactionId, clientTransactionId) {
  const query = new URLSearchParams({
    id: transactionId,
    clientTransactionID: clientTransactionId,
  });
  return `${api}/payments/payphone/callback/${signature}?${query}`;
}

async function main() {
  if (!secret || !process.env.DATABASE_URL) {
    throw new Error(
      "PAYMENTS_CALLBACK_SECRET and DATABASE_URL must be set in .env",
    );
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const health = await fetch(`${api}/health`);
    check(
      "API reachable through APISIX",
      health.status === 200,
      `HTTP ${health.status}`,
    );

    const created = await fetch(`${api}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        items: [{ sku: "MG-DEMO-001", quantity: 1 }],
        customer: {
          firstName: "Smoke",
          lastName: "Gateway",
          email: "smoke@example.invalid",
          phone: "0991234567",
        },
        fulfillment: { type: "pickup" },
        billing: {
          identificationType: "cedula",
          identification: "1710034065",
          name: "Smoke Gateway",
          email: "smoke@example.invalid",
          address: "Quito",
        },
      }),
    });
    const order = await created.json();
    check("order created", created.status === 201, `HTTP ${created.status}`);
    if (created.status !== 201) return;
    const auth = { authorization: `Bearer ${order.accessToken}` };

    const started = await fetch(`${api}/orders/${order.order.id}/payments`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    });
    check(
      "payment started (simulated mode)",
      started.status === 201,
      `HTTP ${started.status}`,
    );
    if (started.status !== 201) return;
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.order.id },
    });

    const forged = createHmac("sha256", "not-the-secret")
      .update(payment.clientTransactionId)
      .digest("base64url");
    const invalid = await fetch(
      callbackUrl(
        forged,
        payment.providerTransactionId,
        payment.clientTransactionId,
      ),
    );
    check(
      "invalid signature rejected via gateway",
      invalid.status === 401,
      `HTTP ${invalid.status}`,
    );

    const signature = createHmac("sha256", secret)
      .update(payment.clientTransactionId)
      .digest("base64url");
    const url = callbackUrl(
      signature,
      payment.providerTransactionId,
      payment.clientTransactionId,
    );
    const first = await fetch(url);
    const firstBody = await first.json();
    check(
      "valid callback settled via gateway",
      first.status === 200 &&
        ["settled", "duplicate"].includes(firstBody.result),
      `HTTP ${first.status} ${firstBody.result}`,
    );
    const second = await (await fetch(url, { method: "POST" })).json();
    check(
      "duplicate callback ignored",
      second.result === "duplicate",
      second.result,
    );

    const detail = await (
      await fetch(`${api}/orders/${order.order.id}`, { headers: auth })
    ).json();
    check(
      "order confirmed",
      detail.order?.status === "confirmed",
      detail.order?.status,
    );
    const outbox = await prisma.outboxEvent.count({
      where: { orderId: order.order.id },
    });
    check(
      "one order.confirmed.v1 outbox event",
      outbox === 1,
      `${outbox} event(s)`,
    );

    const burst = await Promise.all(
      Array.from({ length: 40 }, () =>
        fetch(callbackUrl(forged, "1", payment.clientTransactionId)).then(
          (r) => r.status,
        ),
      ),
    );
    const limited = burst.filter((status) => status === 429).length;
    check(
      "APISIX rate limit on the callback route",
      limited > 0 && burst.every((s) => s === 401 || s === 429),
      `${limited} of 40 answered 429`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    check("smoke test", false, error.message);
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  });
