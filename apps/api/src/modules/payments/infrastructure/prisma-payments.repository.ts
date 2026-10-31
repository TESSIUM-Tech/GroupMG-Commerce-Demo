import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import type { OrderStatus } from "../../orders/domain/order-status";
import { decideApprovedPayment } from "../domain/approved-payment-policy";
import { decideFailedPayment } from "../domain/failed-payment-policy";
import type {
  PayableOrder,
  PaymentStatus,
  PaymentView,
  PaymentsRepository,
  PreparePaymentInput,
  PreparePaymentResult,
  SettlementInput,
  SettlementResult,
  StoredPayment,
} from "../domain/payments.repository.port";

type Tx = Prisma.TransactionClient;

interface LockedReservation {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  expiresAt: Date;
}

const paymentSelect = {
  id: true,
  orderId: true,
  status: true,
  amountMinor: true,
  currency: true,
  createdAt: true,
} satisfies Prisma.PaymentSelect;

@Injectable()
export class PrismaPaymentsRepository implements PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPayableOrder(
    orderId: string,
    accessTokenHash: string,
    now: Date,
  ): Promise<PayableOrder | null> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        accessTokenHash,
        accessTokenExpiresAt: { gt: now },
      },
      select: {
        id: true,
        status: true,
        currency: true,
        reservationExpiresAt: true,
        totalMinor: true,
        shippingMinor: true,
        shippingTaxRateBps: true,
        shippingTaxMinor: true,
        items: {
          select: {
            quantity: true,
            unitPriceMinor: true,
            taxRateBps: true,
            taxMinor: true,
          },
        },
        customer: { select: { phone: true } },
      },
    });
    if (!order) return null;
    const { customer, ...rest } = order;
    return { ...rest, customerPhone: customer.phone };
  }

  preparePayment(input: PreparePaymentInput): Promise<PreparePaymentResult> {
    const { orderId, now } = input;
    return this.prisma.$transaction(async (tx) => {
      // Lock order: reservations first, then the order. The expiry sweep uses
      // SKIP LOCKED on reservations, so it never waits on us (no deadlock), and
      // a concurrent start for the same order waits here and then sees our
      // pending payment.
      const reservations = await tx.$queryRaw<
        { status: string; expiresAt: Date }[]
      >`
        SELECT "status"::text AS "status", "expiresAt" FROM "StockReservation"
        WHERE "orderId" = ${orderId}::uuid ORDER BY "id" FOR UPDATE`;
      const [order] = await tx.$queryRaw<
        {
          status: PayableOrder["status"];
          currency: string;
          reservationExpiresAt: Date;
        }[]
      >`
        SELECT "status"::text AS "status", "currency", "reservationExpiresAt"
        FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      if (!order) return { kind: "not_payable", status: "canceled" };
      if (order.status !== "pending_payment") {
        return { kind: "not_payable", status: order.status };
      }
      const reservationsActive =
        reservations.length > 0 &&
        reservations.every((r) => r.status === "active" && r.expiresAt > now);
      if (order.reservationExpiresAt <= now || !reservationsActive) {
        return { kind: "reservation_expired" };
      }

      const pending = await tx.payment.findFirst({
        where: { orderId, status: "pending" },
        orderBy: { createdAt: "desc" },
        select: paymentSelect,
      });
      if (pending) {
        return {
          kind: "existing",
          payment: pending,
          reservationExpiresAt: order.reservationExpiresAt,
        };
      }

      // Improvement A: never shorten, only extend to cover PayPhone's window.
      const reservationExpiresAt =
        input.reservationUntil > order.reservationExpiresAt
          ? input.reservationUntil
          : order.reservationExpiresAt;
      await tx.order.update({
        where: { id: orderId },
        data: { reservationExpiresAt },
        select: { id: true },
      });
      await tx.stockReservation.updateMany({
        where: { orderId, status: "active" },
        data: { expiresAt: reservationExpiresAt },
      });
      const payment = await tx.payment.create({
        data: {
          orderId,
          currency: order.currency,
          clientTransactionId: input.clientTransactionId,
          amountMinor: input.amountMinor,
          createdAt: now,
        },
        select: paymentSelect,
      });
      return { kind: "created", payment, reservationExpiresAt };
    });
  }

  async recordProviderTransaction(
    paymentId: string,
    providerTransactionId: string,
  ): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: "pending", providerTransactionId: null },
      data: { providerTransactionId },
    });
  }

  async cancelPendingPayment(paymentId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: "pending" },
      data: { status: "canceled" },
    });
  }

  findPendingPayments(
    createdBefore: Date,
    limit: number,
  ): Promise<(StoredPayment & { createdAt: Date })[]> {
    return this.prisma.payment.findMany({
      where: { status: "pending", createdAt: { lte: createdBefore } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        orderId: true,
        status: true,
        amountMinor: true,
        currency: true,
        clientTransactionId: true,
        providerTransactionId: true,
        createdAt: true,
      },
    });
  }

  async flagPendingForReview(paymentId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: "pending" },
      data: { status: "review_required" },
    });
  }

  findPaymentByClientTransactionId(
    clientTransactionId: string,
  ): Promise<StoredPayment | null> {
    return this.prisma.payment.findUnique({
      where: { clientTransactionId },
      select: {
        id: true,
        orderId: true,
        status: true,
        amountMinor: true,
        currency: true,
        clientTransactionId: true,
        providerTransactionId: true,
      },
    });
  }

  settle(input: SettlementInput): Promise<SettlementResult> {
    const { now } = input;
    return this.prisma.$transaction(async (tx) => {
      // 1. Receipt first: a repeated event stops here and changes nothing.
      // Concurrent duplicates wait on the unique index and then skip.
      const receipt = await tx.webhookReceipt.createMany({
        data: [
          {
            provider: "payphone",
            eventKey: input.eventKey,
            paymentId: input.paymentId,
            payloadHash: input.payloadHash,
            receivedAt: now,
            verifiedAt: now,
            processedAt: now,
          },
        ],
        skipDuplicates: true,
      });
      if (receipt.count === 0) return { kind: "duplicate" };

      // 2. Locks in the global order: inventory -> reservations -> order ->
      // payment (same as order creation, payment start and expiry sweep).
      const { orderId } = await tx.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        select: { orderId: true },
      });
      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: {
          productId: true,
          sku: true,
          quantity: true,
          unitPriceMinor: true,
        },
        orderBy: { productId: "asc" },
      });
      const productIds = items.map((item) => item.productId);
      await tx.$queryRaw`
        SELECT "productId" FROM "Inventory"
        WHERE "productId" = ANY(${productIds}::uuid[])
        ORDER BY "productId" FOR UPDATE`;
      const reservations = await tx.$queryRaw<LockedReservation[]>`
        SELECT "id"::text AS "id", "productId"::text AS "productId", "quantity",
               "status"::text AS "status", "expiresAt"
        FROM "StockReservation" WHERE "orderId" = ${orderId}::uuid
        ORDER BY "id" FOR UPDATE`;
      const [order] = await tx.$queryRaw<
        { status: OrderStatus; currency: string; totalMinor: number }[]
      >`
        SELECT "status"::text AS "status", "currency", "totalMinor"
        FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const [payment] = await tx.$queryRaw<
        { status: PaymentStatus; providerTransactionId: string | null }[]
      >`
        SELECT "status"::text AS "status", "providerTransactionId"
        FROM "Payment" WHERE "id" = ${input.paymentId}::uuid FOR UPDATE`;
      if (!order || !payment)
        throw new Error("Payment settlement lost its order");

      const providerTransactionId =
        payment.providerTransactionId ?? input.providerTransactionId;

      if (input.providerStatus !== "approved") {
        const otherPending = await tx.payment.count({
          where: { orderId, status: "pending", id: { not: input.paymentId } },
        });
        const decision = decideFailedPayment({
          outcome: input.providerStatus,
          paymentStatus: payment.status,
          orderStatus: order.status,
          otherPendingPayments: otherPending > 0,
        });
        if (decision.releaseReservations) {
          await this.releaseActive(tx, reservations, now);
        }
        if (decision.orderStatus) {
          await tx.order.update({
            where: { id: orderId },
            data: { status: decision.orderStatus },
            select: { id: true },
          });
        }
        if (decision.paymentStatus) {
          await tx.payment.update({
            where: { id: input.paymentId },
            data: {
              status: decision.paymentStatus,
              providerTransactionId,
              verifiedAt: now,
            },
            select: { id: true },
          });
        }
        return {
          kind: "settled",
          paymentStatus: decision.paymentStatus ?? payment.status,
          orderStatus: decision.orderStatus ?? order.status,
          reason: decision.reason,
          outboxEventId: null,
        };
      }

      // Approved. Reservations already past their expiry are released first,
      // so "is the stock still free?" is answered on current numbers.
      const expired = reservations.filter(
        (r) => r.status === "active" && r.expiresAt <= now,
      );
      await this.releaseActive(tx, expired, now);
      const active = reservations.filter(
        (r) => r.status === "active" && r.expiresAt > now,
      );
      const reservationsActive =
        reservations.length > 0 && active.length === reservations.length;
      const inventory = await tx.inventory.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, onHand: true, reserved: true },
      });
      const free = new Map(
        inventory.map((row) => [row.productId, row.onHand - row.reserved]),
      );
      const stockAvailable = items.every(
        (item) => (free.get(item.productId) ?? 0) >= item.quantity,
      );
      const decision = decideApprovedPayment({
        orderStatus: order.status,
        reservationsActive,
        stockAvailable,
        alreadyApplied: payment.status === "approved",
      });

      if (decision.stock === "consume_reservation") {
        for (const reservation of active) {
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { status: "consumed" },
            select: { id: true },
          });
          await tx.$executeRaw`
            UPDATE "Inventory"
            SET "onHand" = "onHand" - ${reservation.quantity},
                "reserved" = "reserved" - ${reservation.quantity},
                "updatedAt" = ${now}
            WHERE "productId" = ${reservation.productId}::uuid`;
        }
      } else if (decision.stock === "take_available") {
        for (const item of items) {
          const taken = await tx.$executeRaw`
            UPDATE "Inventory"
            SET "onHand" = "onHand" - ${item.quantity}, "updatedAt" = ${now}
            WHERE "productId" = ${item.productId}::uuid
              AND "onHand" - "reserved" >= ${item.quantity}`;
          // Rows are locked and availability was just checked: cannot happen.
          if (taken !== 1) throw new Error("Stock changed under lock");
        }
      }
      if (decision.orderStatus) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: decision.orderStatus },
          select: { id: true },
        });
      }
      if (payment.status !== decision.paymentStatus) {
        await tx.payment.update({
          where: { id: input.paymentId },
          data: {
            status: decision.paymentStatus,
            providerTransactionId,
            verifiedAt: now,
          },
          select: { id: true },
        });
      }

      let outboxEventId: string | null = null;
      if (decision.orderStatus === "confirmed") {
        // Same transaction as the confirmation: no sale without its event.
        outboxEventId = randomUUID();
        await tx.outboxEvent.create({
          data: {
            id: outboxEventId,
            orderId,
            type: "order.confirmed.v1",
            payload: {
              eventId: outboxEventId,
              type: "order.confirmed.v1",
              occurredAt: now.toISOString(),
              correlationId: input.correlationId,
              data: {
                orderId,
                currency: order.currency,
                totalMinor: order.totalMinor,
                items: items.map(({ sku, quantity, unitPriceMinor }) => ({
                  sku,
                  quantity,
                  unitPriceMinor,
                })),
              },
            },
            createdAt: now,
          },
          select: { id: true },
        });
        console.log(
          `[API] Order confirmed: orderId=${orderId} eventId=${outboxEventId} correlationId=${input.correlationId}`,
        );
      }
      return {
        kind: "settled",
        paymentStatus: decision.paymentStatus,
        orderStatus: decision.orderStatus ?? order.status,
        reason: decision.reason,
        outboxEventId,
      };
    });
  }

  /** active -> released once, giving the units back to free stock. */
  private async releaseActive(
    tx: Tx,
    reservations: LockedReservation[],
    now: Date,
  ): Promise<void> {
    for (const reservation of reservations) {
      const released = await tx.stockReservation.updateMany({
        where: { id: reservation.id, status: "active" },
        data: { status: "released" },
      });
      if (released.count === 1) {
        await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reserved" = "reserved" - ${reservation.quantity}, "updatedAt" = ${now}
          WHERE "productId" = ${reservation.productId}::uuid`;
      }
    }
  }
}
