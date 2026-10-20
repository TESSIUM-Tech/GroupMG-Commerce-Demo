import type { ErpPort, ErpSale } from "../../ports/erp.port";
import {
  ErpConflictError,
  ErpContractError,
  ErpRequestError,
  ErpUnavailableError,
} from "../../ports/erp.errors";
import {
  fromInventoryDto,
  fromSaleDto,
  toSaleDto,
} from "./simulated-erp.mapper";

export interface SimulatedErpOptions {
  baseUrl: string;
  timeoutMs: number;
  pageSize?: number;
}

export class SimulatedErpAdapter implements ErpPort {
  private readonly baseUrl: string;
  constructor(
    private readonly options: SimulatedErpOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    )
      throw new Error("Invalid ERP_BASE_URL");
    if (
      !Number.isInteger(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      options.timeoutMs > 60000 ||
      !Number.isInteger(options.pageSize ?? 20) ||
      (options.pageSize ?? 20) < 1 ||
      (options.pageSize ?? 20) > 100
    )
      throw new Error("Invalid ERP adapter limits");
    this.baseUrl = url.origin;
  }

  async getInventory(cursor?: string) {
    const params = new URLSearchParams({
      limit: String(this.options.pageSize ?? 20),
    });
    if (cursor !== undefined) params.set("cursor", cursor);
    return fromInventoryDto(await this.request(`/v1/inventory?${params}`));
  }

  async postSale(sale: ErpSale, idempotencyKey: string) {
    return fromSaleDto(
      await this.request("/v1/sales", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(toSaleDto(sale)),
      }),
      sale.orderId,
    );
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    try {
      const res = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (res.status === 409)
        throw new ErpConflictError("ERP reference or idempotency conflict");
      if (res.status >= 500 || res.status === 429 || res.status === 408)
        throw new ErpUnavailableError("ERP temporarily unavailable");
      if (!res.ok)
        throw new ErpRequestError(`ERP rejected request (${res.status})`);
      try {
        return await res.json();
      } catch (error) {
        if (
          error instanceof Error &&
          ["TimeoutError", "AbortError"].includes(error.name)
        )
          throw error;
        throw new ErpContractError("ERP returned invalid JSON");
      }
    } catch (error) {
      if (
        error instanceof ErpConflictError ||
        error instanceof ErpContractError ||
        error instanceof ErpRequestError ||
        error instanceof ErpUnavailableError
      )
        throw error;
      throw new ErpUnavailableError("ERP connection failed or timed out");
    }
  }
}
