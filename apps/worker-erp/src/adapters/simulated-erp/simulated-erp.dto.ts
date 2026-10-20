/** External HTTP contract. These types must not cross ErpPort. */
export interface SimulatorInventoryDto {
  records: Array<{
    product_code: string;
    quantity_available: number;
    modified_at: string;
  }>;
  next_cursor: string | null;
}
export interface SimulatorSaleDto {
  reference: string;
  currency_code: string;
  gross_amount_minor: number;
}
export interface SimulatorSaleResultDto {
  sale_id: string;
  reference: string;
}
