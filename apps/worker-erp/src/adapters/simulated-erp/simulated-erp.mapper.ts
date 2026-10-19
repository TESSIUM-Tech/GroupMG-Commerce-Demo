import type { ErpSale, InventoryItem } from "../../ports/erp.port";
import { ErpContractError } from "../../ports/erp.errors";
import type {
  SimulatorSaleDto,
  SimulatorInventoryDto,
  SimulatorSaleResultDto,
} from "./simulated-erp.dto";

export function toSaleDto(sale: ErpSale): SimulatorSaleDto {
  return {
    reference: sale.orderId,
    currency_code: sale.currency,
    gross_amount_minor: sale.totalMinor,
  };
}

export function fromInventoryDto(value: unknown): {
  items: InventoryItem[];
  nextCursor?: string;
} {
  const data = value as SimulatorInventoryDto | null;
  if (
    !data ||
    !Array.isArray(data.records) ||
    !(
      data.next_cursor === null ||
      (typeof data.next_cursor === "string" &&
        /^[A-Za-z0-9_-]{1,256}$/.test(data.next_cursor))
    )
  )
    throw new ErpContractError("Invalid ERP inventory response");
  const seen = new Set<string>();
  const items = data.records.map((row) => {
    if (
      !row ||
      typeof row.product_code !== "string" ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(row.product_code) ||
      seen.has(row.product_code) ||
      !Number.isSafeInteger(row.quantity_available) ||
      row.quantity_available < 0 ||
      typeof row.modified_at !== "string" ||
      !Number.isFinite(Date.parse(row.modified_at))
    )
      throw new ErpContractError("Invalid ERP inventory record");
    seen.add(row.product_code);
    return {
      sku: row.product_code,
      available: row.quantity_available,
      updatedAt: new Date(row.modified_at).toISOString(),
    };
  });
  return {
    items,
    ...(data.next_cursor !== null ? { nextCursor: data.next_cursor } : {}),
  };
}

export function fromSaleDto(
  value: unknown,
  reference: string,
): { externalId: string } {
  const data = value as SimulatorSaleResultDto | null;
  if (
    !data ||
    typeof data.sale_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.sale_id,
    ) ||
    data.reference !== reference
  )
    throw new ErpContractError("Invalid ERP sale response");
  return { externalId: data.sale_id };
}
