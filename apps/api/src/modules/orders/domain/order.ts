import type { OrderStatus } from "./order-status";

export type IdentificationType = "cedula" | "ruc" | "passport";

export interface OrderLineRequest {
  sku: string;
  quantity: number;
}

export interface ShippingAddress {
  province: string;
  city: string;
  zone: string;
  address: string;
  reference: string;
}

export type Fulfillment =
  { type: "pickup" } | { type: "courier"; shippingAddress: ShippingAddress };

export interface GuestContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface BillingDetails {
  identificationType: IdentificationType;
  identification: string;
  name: string;
  email: string;
  address: string;
}

/** Normalized request: items sorted by SKU so equal requests hash equally. */
export interface CreateOrderCommand {
  items: OrderLineRequest[];
  customer: GuestContact;
  fulfillment: Fulfillment;
  billing: BillingDetails;
}

/** Public projection of an order; excludes personal data and internal hashes. */
export interface OrderView {
  id: string;
  status: OrderStatus;
  currency: string;
  fulfillment: "pickup" | "courier";
  items: {
    sku: string;
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    taxRateBps: number;
    taxMinor: number;
    totalMinor: number;
  }[];
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  shippingTaxMinor: number;
  totalMinor: number;
  reservationExpiresAt: Date;
  createdAt: Date;
}
