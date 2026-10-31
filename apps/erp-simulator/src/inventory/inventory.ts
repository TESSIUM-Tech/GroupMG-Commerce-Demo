export interface InventoryRecord {
  product_code: string;
  quantity_available: number;
  modified_at: string;
}
export interface InventoryPage {
  records: InventoryRecord[];
  next_cursor: string | null;
}

export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (
    !/^[A-Za-z0-9._-]{1,100}$/.test(decoded) ||
    Buffer.from(decoded).toString("base64url") !== cursor
  ) {
    throw new Error("Invalid cursor");
  }
  return decoded;
}
