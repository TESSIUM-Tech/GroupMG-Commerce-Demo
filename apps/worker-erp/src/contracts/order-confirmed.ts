import type { OrderConfirmedV1 } from "@groupmg/contracts";

export type { OrderConfirmedV1 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MINOR = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown, allowZero = false): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value <= MAX_MINOR &&
    (allowZero ? value >= 0 : value > 0)
  );
}

/**
 * Runtime validation of order.confirmed.v1 (packages/contracts only offers the
 * TypeScript type, which says nothing about what actually arrives). Returns
 * the reasons it is invalid; an empty list means the event can be trusted.
 */
export function validateOrderConfirmedV1(value: unknown): string[] {
  if (!isRecord(value)) return ["event must be a JSON object"];
  const problems: string[] = [];
  if (typeof value.eventId !== "string" || !UUID.test(value.eventId)) {
    problems.push("eventId must be a UUID");
  }
  if (value.type !== "order.confirmed.v1") {
    problems.push("type must be order.confirmed.v1");
  }
  if (
    typeof value.occurredAt !== "string" ||
    Number.isNaN(Date.parse(value.occurredAt))
  ) {
    problems.push("occurredAt must be an ISO date");
  }
  if (typeof value.correlationId !== "string" || !value.correlationId.trim()) {
    problems.push("correlationId is required");
  }
  const data = value.data;
  if (!isRecord(data)) return [...problems, "data must be an object"];
  if (typeof data.orderId !== "string" || !UUID.test(data.orderId)) {
    problems.push("data.orderId must be a UUID");
  }
  if (typeof data.currency !== "string" || !/^[A-Z]{3}$/.test(data.currency)) {
    problems.push("data.currency must be an ISO 4217 code");
  }
  if (!isAmount(data.totalMinor)) {
    problems.push("data.totalMinor must be a positive integer amount");
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    problems.push("data.items must be a non-empty array");
  } else {
    data.items.forEach((item, index) => {
      if (
        !isRecord(item) ||
        typeof item.sku !== "string" ||
        !item.sku.trim() ||
        !isAmount(item.quantity) ||
        !isAmount(item.unitPriceMinor)
      ) {
        problems.push(
          `data.items[${index}] needs sku, quantity and unitPriceMinor`,
        );
      }
    });
  }
  return problems;
}

export function isOrderConfirmedV1(value: unknown): value is OrderConfirmedV1 {
  return validateOrderConfirmedV1(value).length === 0;
}
