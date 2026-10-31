import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import type { OrderView } from "../domain/order";
import {
  InsufficientStockError,
  ProductUnavailableError,
  ShippingRateUnavailableError,
} from "../domain/order-errors";
import { priceOrder, type ShippingCharge } from "../domain/order-pricing";
import type {
  CreatePendingOrderResult,
  NewPendingOrder,
  OrdersRepository,
  ReleasedReservations,
} from "../domain/orders.repository.port";

/** Single demo currency (docs/demo-rules.md); also enforced by CHECK constraints. */
const ORDER_CURRENCY = "USD";

const orderSelect = {
  id: true,
  status: true,
  currency: true,
  fulfillment: true,
  subtotalMinor: true,
  taxMinor: true,
  shippingMinor: true,
  shippingTaxMinor: true,
  totalMinor: true,
  reservationExpiresAt: true,
  createdAt: true,
  items: {
    select: {
      sku: true,
      productName: true,
      quantity: true,
      unitPriceMinor: true,
      taxRateBps: true,
      taxMinor: true,
      totalMinor: true,
    },
    orderBy: { sku: "asc" },
  },
} satisfies Prisma.OrderSelect;

type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

function toView(record: OrderRecord): OrderView {
  return {
    ...record,
    fulfillment: record.fulfillment === "courier" ? "courier" : "pickup",
  };
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaOrdersRepository implements OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPendingOrder(
    input: NewPendingOrder,
  ): Promise<CreatePendingOrderResult> {
    const { command, now } = input;
    return this.prisma.$transaction(async (tx) => {
      // Requests sharing a key run one at a time, so a replay never competes
      // for stock with its own original request.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
      const existing = await tx.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { ...orderSelect, requestHash: true },
      });
      if (existing) {
        const { requestHash, ...order } = existing;
        return { created: false, order: toView(order), requestHash };
      }

      const skus = command.items.map((item) => item.sku);
      const products = await tx.product.findMany({
        where: { sku: { in: skus }, published: true },
        select: {
          id: true,
          sku: true,
          supplierReference: true,
          name: true,
          priceMinor: true,
          taxRateBps: true,
        },
      });
      const bySku = new Map(products.map((product) => [product.sku, product]));
      const unavailable = skus.filter((sku) => !bySku.has(sku));
      if (unavailable.length > 0)
        throw new ProductUnavailableError(unavailable);

      const lines = command.items
        .map((item) => ({
          product: bySku.get(item.sku)!,
          quantity: item.quantity,
        }))
        .sort((a, b) => (a.product.id < b.product.id ? -1 : 1));
      const productIds = lines.map((line) => line.product.id);

      await this.lockInventory(tx, productIds);
      await this.releaseExpired(tx, now, 1000, productIds);

      let shipping: ShippingCharge | null = null;
      let shippingRateVersion: number | null = null;
      if (command.fulfillment.type === "courier") {
        const rate = await tx.shippingRate.findFirst({
          where: {
            zone: command.fulfillment.shippingAddress.zone,
            currency: ORDER_CURRENCY,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          orderBy: { version: "desc" },
        });
        if (!rate) throw new ShippingRateUnavailableError();
        shipping = {
          amountMinor: rate.amountMinor,
          taxRateBps: rate.taxRateBps,
        };
        shippingRateVersion = rate.version;
      }
      const totals = priceOrder(lines, shipping);

      // Conditional increment: concurrent buyers of the last unit cannot both win.
      const insufficient: string[] = [];
      for (const { product, quantity } of lines) {
        const updated = await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reserved" = "reserved" + ${quantity}, "updatedAt" = ${now}
          WHERE "productId" = ${product.id}::uuid
            AND "onHand" - "reserved" >= ${quantity}`;
        if (updated !== 1) insufficient.push(product.sku);
      }
      if (insufficient.length > 0) {
        throw new InsufficientStockError(insufficient.sort());
      }

      const customer = await tx.guestCustomer.create({
        data: command.customer,
        select: { id: true },
      });
      const lineBySku = new Map(totals.lines.map((line) => [line.sku, line]));
      const order = await tx.order.create({
        data: {
          customerId: customer.id,
          currency: ORDER_CURRENCY,
          subtotalMinor: totals.subtotalMinor,
          taxMinor: totals.taxMinor,
          shippingMinor: totals.shippingMinor,
          shippingTaxMinor: totals.shippingTaxMinor,
          totalMinor: totals.totalMinor,
          fulfillment: command.fulfillment.type,
          ...(command.fulfillment.type === "courier"
            ? {
                shippingZone: command.fulfillment.shippingAddress.zone,
                shippingRateVersion,
                shippingTaxRateBps: shipping!.taxRateBps,
                shippingAddress: { ...command.fulfillment.shippingAddress },
              }
            : {}),
          customerSnapshot: { ...command.customer },
          billingIdentificationType: command.billing.identificationType,
          billingIdentification: command.billing.identification,
          billingName: command.billing.name,
          billingAddress: { line: command.billing.address },
          billingEmail: command.billing.email,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          accessTokenHash: input.accessTokenHash,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          reservationExpiresAt: input.reservationExpiresAt,
          createdAt: now,
          items: {
            create: lines.map(({ product }) => {
              const line = lineBySku.get(product.sku)!;
              return {
                productId: product.id,
                sku: product.sku,
                supplierReference: product.supplierReference,
                productName: product.name,
                quantity: line.quantity,
                unitPriceMinor: line.unitPriceMinor,
                taxRateBps: line.taxRateBps,
                taxMinor: line.taxMinor,
                totalMinor: line.totalMinor,
              };
            }),
          },
          reservations: {
            create: lines.map(({ product, quantity }) => ({
              productId: product.id,
              quantity,
              expiresAt: input.reservationExpiresAt,
              createdAt: now,
            })),
          },
        },
        select: orderSelect,
      });
      return { created: true, order: toView(order) };
    });
  }

  async replaceAccessToken(
    orderId: string,
    accessTokenHash: string,
    accessTokenExpiresAt: Date,
  ): Promise<void> {
    await this.prisma.order.update({
      where: { id: orderId },
      data: { accessTokenHash, accessTokenExpiresAt },
      select: { id: true },
    });
  }

  async findByAccessToken(
    orderId: string,
    accessTokenHash: string,
    now: Date,
  ): Promise<OrderView | null> {
    const record = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        accessTokenHash,
        accessTokenExpiresAt: { gt: now },
      },
      select: orderSelect,
    });
    return record ? toView(record) : null;
  }

  releaseExpiredReservations(
    now: Date,
    limit: number,
  ): Promise<ReleasedReservations> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ productId: string }[]>`
        SELECT DISTINCT "productId"::text AS "productId" FROM "StockReservation"
        WHERE "status" = 'active' AND "expiresAt" <= ${now}`;
      if (rows.length === 0) return { reservations: 0, orders: 0 };
      const productIds = rows.map((row) => row.productId);
      await this.lockInventory(tx, productIds);
      return this.releaseExpired(tx, now, limit, productIds);
    });
  }

  /** Every writer locks inventory rows in productId order to avoid deadlocks. */
  private async lockInventory(tx: Tx, productIds: string[]): Promise<void> {
    await tx.$queryRaw`
      SELECT "productId" FROM "Inventory"
      WHERE "productId" = ANY(${productIds}::uuid[])
      ORDER BY "productId" FOR UPDATE`;
  }

  /**
   * Releases expired active reservations once: reservation -> released,
   * inventory.reserved decremented, pending order -> expired.
   */
  private async releaseExpired(
    tx: Tx,
    now: Date,
    limit: number,
    productIds: string[],
  ): Promise<ReleasedReservations> {
    const [result] = await tx.$queryRaw<ReleasedReservations[]>`
      WITH expired AS (
        UPDATE "StockReservation" r SET "status" = 'released'
        WHERE r."id" IN (
          SELECT "id" FROM "StockReservation"
          WHERE "status" = 'active' AND "expiresAt" <= ${now}
            AND "productId" = ANY(${productIds}::uuid[])
          ORDER BY "expiresAt"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
        RETURNING r."orderId", r."productId", r."quantity"
      ), stock AS (
        UPDATE "Inventory" i
        SET "reserved" = i."reserved" - e."quantity", "updatedAt" = ${now}
        FROM (
          SELECT "productId", SUM("quantity")::int AS "quantity"
          FROM expired GROUP BY "productId"
        ) e
        WHERE i."productId" = e."productId"
        RETURNING i."productId"
      ), orders AS (
        UPDATE "Order" o SET "status" = 'expired', "updatedAt" = ${now}
        WHERE o."id" IN (SELECT "orderId" FROM expired)
          AND o."status" = 'pending_payment'
        RETURNING o."id"
      )
      SELECT (SELECT COUNT(*) FROM expired)::int AS "reservations",
             (SELECT COUNT(*) FROM orders)::int AS "orders"`;
    return result ?? { reservations: 0, orders: 0 };
  }
}
