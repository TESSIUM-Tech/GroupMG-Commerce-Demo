import {
  PaymentProviderRejectedError,
  PaymentProviderUnavailableError,
  type CreateSaleRequest,
  type PaymentProvider,
  type ProviderSale,
  type ProviderSaleStatus,
} from "../domain/payment-provider.port";
import type { PayPhoneCredentials } from "./payments.config";

/** Same base URL for test and production; the app's environment decides. */
export const PAYPHONE_BASE_URL = "https://pay.payphonetodoesposible.com";
const TIMEOUT_MS = 10_000;
/** Documented budget for the status endpoint. */
export const STATUS_QUERIES_PER_MINUTE = 30;

type Fetch = typeof fetch;

/** Sliding one-minute window shared by every status query in this process. */
export class StatusQueryBudget {
  private readonly calls: number[] = [];

  constructor(
    private readonly limit = STATUS_QUERIES_PER_MINUTE,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(): boolean {
    const current = this.now();
    while (this.calls.length > 0 && current - this.calls[0]! >= 60_000) {
      this.calls.shift();
    }
    if (this.calls.length >= this.limit) return false;
    this.calls.push(current);
    return true;
  }
}

// PayPhone statusCode: 1 pending, 2 canceled, 3 approved (docs.payphone.app/api-sale).
const STATUS_CODES: Record<number, ProviderSaleStatus> = {
  1: "pending",
  2: "canceled",
  3: "approved",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idString(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    return value;
  }
  return null;
}

/** Validates the provider response at runtime; never trusts its shape. */
function toProviderSale(body: unknown): ProviderSale {
  if (!isRecord(body)) {
    throw new PaymentProviderUnavailableError(
      "PayPhone returned an invalid sale",
    );
  }
  const transactionId = idString(body.transactionId);
  const clientTransactionId =
    typeof body.clientTransactionId === "string"
      ? body.clientTransactionId
      : null;
  const status =
    typeof body.statusCode === "number"
      ? STATUS_CODES[body.statusCode]
      : undefined;
  const amountMinor = body.amount;
  const currency = body.currency;
  if (
    !transactionId ||
    !clientTransactionId ||
    !status ||
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    typeof currency !== "string"
  ) {
    throw new PaymentProviderUnavailableError(
      "PayPhone returned an invalid sale",
    );
  }
  return { transactionId, clientTransactionId, status, amountMinor, currency };
}

/** Extracts PayPhone's error text ({ message, errorCode, errors[] }). */
function providerMessage(body: unknown): string {
  if (isRecord(body)) {
    const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
    const message = isRecord(first) ? first.message : body.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 200);
    }
  }
  return "PayPhone rejected the request";
}

export class PayPhoneProvider implements PaymentProvider {
  constructor(
    private readonly credentials: PayPhoneCredentials,
    private readonly budget = new StatusQueryBudget(),
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = PAYPHONE_BASE_URL,
  ) {}

  async createSale(
    request: CreateSaleRequest,
  ): Promise<{ transactionId: string }> {
    const body = {
      phoneNumber: request.phoneNumber,
      countryCode: request.countryCode,
      amount: request.amountMinor,
      amountWithoutTax: request.amountWithoutTaxMinor,
      amountWithTax: request.amountWithTaxMinor,
      tax: request.taxMinor,
      service: 0,
      tip: 0,
      currency: request.currency,
      clientTransactionId: request.clientTransactionId,
      reference: request.reference,
      responseUrl: request.responseUrl,
      ...(this.credentials.storeId
        ? { storeId: this.credentials.storeId }
        : {}),
    };
    const result = await this.request("POST", "/api/Sale", body);
    const transactionId = isRecord(result)
      ? idString(result.transactionId)
      : null;
    if (!transactionId) {
      throw new PaymentProviderUnavailableError(
        "PayPhone returned no transactionId",
      );
    }
    return { transactionId };
  }

  async getSale(transactionId: string): Promise<ProviderSale> {
    this.acquireStatusQuery();
    return toProviderSale(
      await this.request(
        "GET",
        `/api/Sale/${encodeURIComponent(transactionId)}`,
      ),
    );
  }

  async findSaleByClientTransactionId(
    clientTransactionId: string,
  ): Promise<ProviderSale | null> {
    this.acquireStatusQuery();
    const result = await this.request(
      "GET",
      `/api/Sale/client/${encodeURIComponent(clientTransactionId)}`,
      undefined,
      true,
    );
    if (result === null) return null;
    // Accept a single sale or a list; keep only the one we asked for.
    const candidates = Array.isArray(result) ? result : [result];
    const match = candidates.find(
      (sale) =>
        isRecord(sale) && sale.clientTransactionId === clientTransactionId,
    );
    return match ? toProviderSale(match) : null;
  }

  private acquireStatusQuery(): void {
    if (!this.budget.tryAcquire()) {
      throw new PaymentProviderUnavailableError(
        "PayPhone status query budget exhausted; retry later",
      );
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    notFoundAsNull = false,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.credentials.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Includes timeouts. Never echo request details: they carry the token.
      throw new PaymentProviderUnavailableError(
        "PayPhone did not respond in time",
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return payload;
    if (notFoundAsNull && response.status === 404) return null;
    if (response.status === 429 || response.status >= 500) {
      throw new PaymentProviderUnavailableError(
        `PayPhone temporarily unavailable (HTTP ${response.status})`,
      );
    }
    throw new PaymentProviderRejectedError(providerMessage(payload));
  }
}
