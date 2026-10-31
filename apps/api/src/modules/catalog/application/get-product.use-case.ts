import type { CatalogRepository } from "../domain/catalog.repository.port";

export class GetProductUseCase {
  constructor(private readonly repository: CatalogRepository) {}

  execute(id: string) {
    return this.repository.findPublishedById(id);
  }
}
