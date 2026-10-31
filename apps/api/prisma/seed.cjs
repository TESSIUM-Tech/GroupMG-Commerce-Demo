const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { config } = require("dotenv");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
config({ path: resolve(__dirname, "../../../.env"), quiet: true });

async function seed() {
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Set ALLOW_DEMO_SEED=true only for a demo database");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const products = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../docs/demo-products.json"),
      "utf8",
    ).replace(/^\uFEFF/, ""),
  );
  const skus = new Set();
  const refs = new Set();
  for (const p of products) {
    if (
      !p.sku ||
      !p.supplierReference ||
      !p.name ||
      !p.category ||
      !p.imageLicense ||
      !p.imageUrl?.startsWith("/demo/products/") ||
      p.currency !== "USD" ||
      !Number.isSafeInteger(p.priceMinor) ||
      p.priceMinor <= 0 ||
      !Number.isSafeInteger(p.stock) ||
      p.stock < 0 ||
      !Number.isSafeInteger(p.taxRateBps) ||
      p.taxRateBps < 0 ||
      p.taxRateBps > 10000 ||
      skus.has(p.sku) ||
      refs.has(p.supplierReference)
    ) {
      throw new Error("Invalid or duplicate demo product");
    }
    skus.add(p.sku);
    refs.add(p.supplierReference);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await prisma.$transaction(async (tx) => {
      // Serialize concurrent seeds without resetting inventory consumed by orders.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261001)`;
      for (const p of products) {
        const category = await tx.category.upsert({
          where: { slug: p.category },
          update: {},
          create: { slug: p.category, name: p.category },
        });
        const data = {
          supplierReference: p.supplierReference,
          name: p.name,
          categoryId: category.id,
          priceMinor: p.priceMinor,
          currency: p.currency,
          taxRateBps: p.taxRateBps,
          imageUrl: p.imageUrl,
          imageLicense: p.imageLicense,
          published: p.published,
        };
        const product = await tx.product.upsert({
          where: { sku: p.sku },
          update: data,
          create: { sku: p.sku, ...data },
        });
        await tx.inventory.upsert({
          where: { productId: product.id },
          update: {},
          create: { productId: product.id, onHand: p.stock },
        });
      }
    });
    console.log(
      `Demo seed complete: ${products.length} products; existing inventory preserved.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
seed().catch(() => {
  console.error(
    "Demo seed failed. Check demo permission, DATABASE_URL, migrations and product data; credentials are not logged.",
  );
  process.exitCode = 1;
});
