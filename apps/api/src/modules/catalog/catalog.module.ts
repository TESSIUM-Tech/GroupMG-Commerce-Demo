import { Module } from "@nestjs/common";
import { CATALOG_REPOSITORY } from "./domain/catalog.repository.port";
import { PrismaCatalogRepository } from "./infrastructure/prisma-catalog.repository";
import type { CatalogRepository } from "./domain/catalog.repository.port";
import { ListProductsUseCase } from "./application/list-products.use-case";
import { GetProductUseCase } from "./application/get-product.use-case";
import { ProductsController } from "./presentation/products.controller";

@Module({
  controllers: [ProductsController],
  providers: [
    PrismaCatalogRepository,
    {
      provide: CATALOG_REPOSITORY,
      useExisting: PrismaCatalogRepository,
    },
    {
      provide: ListProductsUseCase,
      useFactory: (repository: CatalogRepository) =>
        new ListProductsUseCase(repository),
      inject: [CATALOG_REPOSITORY],
    },
    {
      provide: GetProductUseCase,
      useFactory: (repository: CatalogRepository) =>
        new GetProductUseCase(repository),
      inject: [CATALOG_REPOSITORY],
    },
  ],
  exports: [CATALOG_REPOSITORY],
})
export class CatalogModule {}
