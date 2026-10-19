export interface SaleInput {
  reference: string;
  currency_code: string;
  gross_amount_minor: number;
}
export interface SaleResult {
  sale_id: string;
  reference: string;
}
export class SaleConflict extends Error {}

export function parseSale(value: unknown, key: string | undefined): SaleInput {
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw new Error("Invalid Idempotency-Key");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid sale");
  const sale = value as Record<string, unknown>;
  if (
    Object.keys(sale).some(
      (k) => !["reference", "currency_code", "gross_amount_minor"].includes(k),
    ) ||
    typeof sale.reference !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(sale.reference) ||
    typeof sale.currency_code !== "string" ||
    !/^[A-Z]{3}$/.test(sale.currency_code) ||
    !Number.isSafeInteger(sale.gross_amount_minor) ||
    (sale.gross_amount_minor as number) <= 0 ||
    (sale.gross_amount_minor as number) > 2147483647
  ) {
    throw new Error("Invalid sale fields");
  }
  return {
    reference: sale.reference,
    currency_code: sale.currency_code,
    gross_amount_minor: sale.gross_amount_minor as number,
  };
}
