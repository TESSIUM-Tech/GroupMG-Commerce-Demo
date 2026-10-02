import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import type { CatalogRepository } from "../domain/catalog.repository.port";

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countProducts(): Promise<number> {
    return this.prisma.product.count();
  }

  async isReady(): Promise<boolean> {
    return this.prisma.ping();
  }
}
