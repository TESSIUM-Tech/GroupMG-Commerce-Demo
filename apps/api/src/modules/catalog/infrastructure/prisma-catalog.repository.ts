import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CatalogProduct, CatalogQuery } from "../domain/catalog-product";
import { availableQuantity } from "../domain/product-availability";
import { PrismaService } from "../../../database/prisma.service";
import type { CatalogRepository } from "../domain/catalog.repository.port";

const productSelect = {
  id: true,
  sku: true,
  name: true,
  priceMinor: true,
  currency: true,
  taxRateBps: true,
  imageUrl: true,
  category: { select: { slug: true, name: true } },
  inventory: { select: { onHand: true, reserved: true } },
} satisfies Prisma.ProductSelect;

type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function toCatalogProduct(record: ProductRecord): CatalogProduct {
  const { inventory, ...product } = record;
  const quantity = inventory
    ? availableQuantity(inventory.onHand, inventory.reserved)
    : 0;
  return { ...product, availableQuantity: quantity, inStock: quantity > 0 };
}

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listPublished(query: CatalogQuery) {
    const where: Prisma.ProductWhereInput = {
      published: true,
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { sku: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.product.count({ where });
        const skip = (query.page - 1) * query.limit;
        // Avoid sending offsets outside PostgreSQL's integer range for empty pages.
        if (skip >= total) return { items: [], total };
        const records = await tx.product.findMany({
          where,
          select: productSelect,
          skip,
          take: query.limit,
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        return { items: records.map(toCatalogProduct), total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findPublishedById(id: string): Promise<CatalogProduct | null> {
    const record = await this.prisma.product.findFirst({
      where: { id, published: true },
      select: productSelect,
    });
    return record ? toCatalogProduct(record) : null;
  }

  async countProducts(): Promise<number> {
    return this.prisma.product.count();
  }

  async isReady(): Promise<boolean> {
    return this.prisma.ping();
  }
}
