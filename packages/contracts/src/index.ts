/** Contrato propuesto; todavía no existe productor ni consumidor. */
export interface OrderConfirmedV1 {
  eventId: string;
  type: "order.confirmed.v1";
  occurredAt: string;
  correlationId: string;
  data: {
    orderId: string;
    currency: string;
    totalMinor: number;
    items: Array<{ sku: string; quantity: number; unitPriceMinor: number }>;
  };
}
