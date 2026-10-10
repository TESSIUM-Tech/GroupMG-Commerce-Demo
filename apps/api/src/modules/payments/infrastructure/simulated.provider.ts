import { randomUUID } from "node:crypto";
import {
  PaymentProviderRejectedError,
  type CreateSaleRequest,
  type PaymentProvider,
  type ProviderSale,
} from "../domain/payment-provider.port";
import type { SimulatedOutcome } from "./payments.config";

/**
 * Deterministic stand-in for PayPhone (docs/demo-rules.md): every sale resolves
 * to the configured outcome. Enabled only with PAYMENTS_MODE=simulated, never
 * from request parameters; the UI must label a rejection as simulated.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  private readonly sales = new Map<string, ProviderSale>();

  constructor(private readonly outcome: SimulatedOutcome) {}

  async createSale(
    request: CreateSaleRequest,
  ): Promise<{ transactionId: string }> {
    const transactionId = `SIM-${randomUUID()}`;
    this.sales.set(transactionId, {
      transactionId,
      clientTransactionId: request.clientTransactionId,
      status: this.outcome,
      amountMinor: request.amountMinor,
      currency: request.currency,
    });
    return { transactionId };
  }

  async getSale(transactionId: string): Promise<ProviderSale> {
    const sale = this.sales.get(transactionId);
    if (!sale) throw new PaymentProviderRejectedError("Unknown simulated sale");
    return { ...sale };
  }

  async findSaleByClientTransactionId(
    clientTransactionId: string,
  ): Promise<ProviderSale | null> {
    for (const sale of this.sales.values()) {
      if (sale.clientTransactionId === clientTransactionId) return { ...sale };
    }
    return null;
  }
}
