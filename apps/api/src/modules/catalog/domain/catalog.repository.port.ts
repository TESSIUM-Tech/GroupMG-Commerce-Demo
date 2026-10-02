export interface CatalogRepository {
  countProducts(): Promise<number>;
  isReady(): Promise<boolean>;
}

export const CATALOG_REPOSITORY = Symbol("CATALOG_REPOSITORY");
