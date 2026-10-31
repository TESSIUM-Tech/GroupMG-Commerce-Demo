/** Amounts in USD cents, already computed by the backend from the order. */
export interface CreateSaleRequest {
  clientTransactionId: string;
  /** National number without the leading 0, e.g. 9 digits for Ecuador. */
  phoneNumber: string;
  /** Country calling code without "+", e.g. "593". */
  countryCode: string;
  amountMinor: number;
  amountWithTaxMinor: number;
  amountWithoutTaxMinor: number;
  taxMinor: number;
  currency: string;
  reference: string;
  responseUrl: string;
}

/**
 * Provider view of a sale. "rejected" only comes from the simulated provider:
 * PayPhone test mode approves everything and reports cancellations as canceled.
 */
export type ProviderSaleStatus =
  "pending" | "approved" | "canceled" | "rejected";

export interface ProviderSale {
  transactionId: string;
  clientTransactionId: string;
  status: ProviderSaleStatus;
  amountMinor: number;
  currency: string;
}

export interface PaymentProvider {
  createSale(request: CreateSaleRequest): Promise<{ transactionId: string }>;
  getSale(transactionId: string): Promise<ProviderSale>;
  /** Used after a timeout on create, before retrying (docs/demo-rules.md). */
  findSaleByClientTransactionId(
    clientTransactionId: string,
  ): Promise<ProviderSale | null>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

/** Temporary: network, timeout, 5xx, 429 or local rate limit. Retry later. */
export class PaymentProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderUnavailableError";
  }
}

/** The provider refused the request (e.g. phone without a PayPhone account). */
export class PaymentProviderRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderRejectedError";
  }
}
