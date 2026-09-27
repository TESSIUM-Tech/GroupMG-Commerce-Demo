export interface InventoryItem {
  sku: string;
  available: number;
  updatedAt: string;
}
export interface ErpSale {
  orderId: string;
  currency: string;
  totalMinor: number;
}
/** Capa anticorrupción: los DTO del proveedor no salen del adaptador. */
export interface ErpPort {
  getInventory(
    cursor?: string,
  ): Promise<{ items: InventoryItem[]; nextCursor?: string }>;
  postSale(
    sale: ErpSale,
    idempotencyKey: string,
  ): Promise<{ externalId: string }>;
}
