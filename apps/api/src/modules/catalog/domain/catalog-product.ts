export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  category: { slug: string; name: string };
  priceMinor: number;
  currency: string;
  taxRateBps: number;
  imageUrl: string;
  availableQuantity: number;
  inStock: boolean;
}

export interface CatalogQuery {
  page: number;
  limit: number;
  q?: string;
  category?: string;
}

export interface CatalogPage {
  items: CatalogProduct[];
  total: number;
}
