import { Module } from "@nestjs/common";
import { CATALOG_REPOSITORY } from "./domain/catalog.repository.port";
import { PrismaCatalogRepository } from "./infrastructure/prisma-catalog.repository";

@Module({
  providers: [
    PrismaCatalogRepository,
    {
      provide: CATALOG_REPOSITORY,
      useClass: PrismaCatalogRepository,
    },
  ],
  exports: [PrismaCatalogRepository, CATALOG_REPOSITORY],
})
export class CatalogModule {}
