import type { CatalogQuery } from "../domain/catalog-product";
import type { CatalogRepository } from "../domain/catalog.repository.port";

export class ListProductsUseCase {
  constructor(private readonly repository: CatalogRepository) {}

  async execute(query: CatalogQuery) {
    const { items, total } = await this.repository.listPublished(query);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
