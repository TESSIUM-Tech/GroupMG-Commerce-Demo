export interface ProductCategory {
  slug: string;
  name: string;
}

export interface Product {
  id?: string;
  sku: string;
  name: string;
  category: string | ProductCategory;
  priceMinor: number;
  currency?: string;
  taxRateBps?: number;
  imageUrl: string;
  description?: string;
  stock?: number;
  availableQuantity?: number;
  inStock?: boolean;
}

export interface ProductListResponse {
  items: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  correlationId: string;
}

export interface ProductDetailResponse {
  product: Product;
  correlationId: string;
}
