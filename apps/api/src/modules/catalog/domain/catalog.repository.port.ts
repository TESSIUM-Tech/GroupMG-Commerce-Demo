import type {
  CatalogPage,
  CatalogProduct,
  CatalogQuery,
} from "./catalog-product";

export interface CatalogRepository {
  listPublished(query: CatalogQuery): Promise<CatalogPage>;
  findPublishedById(id: string): Promise<CatalogProduct | null>;
  countProducts(): Promise<number>;
  isReady(): Promise<boolean>;
}

export const CATALOG_REPOSITORY = Symbol("CATALOG_REPOSITORY");
