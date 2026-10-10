import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import type {
  PayableOrder,
  PaymentView,
  PaymentsRepository,
  PreparePaymentInput,
  PreparePaymentResult,
} from "../domain/payments.repository.port";

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
}
