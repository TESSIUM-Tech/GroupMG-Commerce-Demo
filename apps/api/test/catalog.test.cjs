const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { ValidationPipe } = require("@nestjs/common");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/database/prisma.service");
const {
  HttpExceptionFilter,
} = require("../dist/common/filters/http-exception.filter");

if (
  process.env.ALLOW_DB_TESTS !== "true" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error(
    "Catalog tests require the isolated commerce_issue2_test database and ALLOW_DB_TESTS=true",
  );
}

describe("Catalog HTTP with PostgreSQL", () => {
  let app, prisma, baseUrl;
  const categoryId = randomUUID();
  const otherCategoryId = randomUUID();
  const slug = `test-${randomUUID()}`;
  const ids = Array.from({ length: 5 }, () => randomUUID());

  before(async () => {
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/products`;
    prisma = app.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      await tx.category.createMany({
        data: [
          { id: categoryId, slug, name: "Catalog test" },
          { id: otherCategoryId, slug: `${slug}-other`, name: "Other" },
        ],
      });
      for (const [index, id] of ids.entries()) {
        await tx.product.create({
          data: {
            id,
            sku: `TEST-${id}`,
            supplierReference: `TEST-${id}`,
            name: `${slug} ${index < 2 ? "Same" : index}`,
            categoryId: index === 4 ? otherCategoryId : categoryId,
            priceMinor: 1234,
            currency: "USD",
            taxRateBps: 1500,
            imageUrl: "/demo/products/MG-DEMO-001.svg",
            imageLicense: "test",
            published: index !== 3,
            ...(index === 2
              ? {}
              : {
                  inventory: {
                    create: { onHand: 5, reserved: index === 1 ? 5 : 2 },
                  },
                }),
          },
        });
      }
    });
  });

  after(async () => {
    try {
      if (prisma)
        await prisma.$transaction(async (tx) => {
          await tx.inventory.deleteMany({ where: { productId: { in: ids } } });
          await tx.product.deleteMany({ where: { id: { in: ids } } });
          await tx.category.deleteMany({
            where: { id: { in: [categoryId, otherCategoryId] } },
          });
        });
    } finally {
      if (app) await app.close();
    }
  });

  async function get(path = "") {
    const response = await fetch(`${baseUrl}${path}`);
    return { response, body: await response.json() };
  }

  test("category and pagination use the same filters, stable tie ordering and metadata", async () => {
    const first = await get(`?category=${slug}&limit=2`);
    const second = await get(`?category=${slug}&limit=2&page=2`);
    assert.equal(first.response.status, 200);
    assert.deepEqual(first.body.pagination, {
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    assert.equal(second.body.items.length, 1);
    const actualIds = [...first.body.items, ...second.body.items].map(
      (p) => p.id,
    );
    assert.equal(new Set(actualIds).size, 3);
    assert.deepEqual(actualIds.slice(1), [ids[0], ids[1]].sort());
    assert.equal(
      first.body.correlationId,
      first.response.headers.get("x-correlation-id"),
    );
  });

  test("search matches name and SKU case-insensitively and combines category with AND", async () => {
    const byName = await get(`?category=${slug}&q=SAME`);
    assert.equal(byName.body.pagination.total, 2);
    const bySku = await get(`?q=${`test-${ids[4]}`}`);
    assert.equal(bySku.body.items[0].id, ids[4]);
    const combined = await get(`?category=${slug}&q=${`test-${ids[4]}`}`);
    assert.deepEqual(combined.body.items, []);
  });

  test("detail exposes public fields, subtracts reservations and keeps exhausted products", async () => {
    const { response, body } = await get(`/${ids[0]}`);
    assert.equal(response.status, 200);
    assert.equal(body.product.priceMinor, 1234);
    assert.equal(body.product.currency, "USD");
    assert.equal(body.product.imageUrl, "/demo/products/MG-DEMO-001.svg");
    assert.equal(body.product.availableQuantity, 3);
    assert.equal(body.product.inStock, true);
    assert.equal(body.product.supplierReference, undefined);
    assert.equal(body.product.inventory, undefined);
    for (const id of [ids[1], ids[2]]) {
      const result = await get(`/${id}`);
      assert.equal(result.body.product.availableQuantity, 0);
      assert.equal(result.body.product.inStock, false);
    }
    const list = await get(`?category=${slug}`);
    assert.ok(list.body.items.some((p) => p.id === ids[1] && !p.inStock));
  });

  test("hidden and missing products return the same 404 error shape", async () => {
    for (const id of [ids[3], randomUUID()]) {
      const { response, body } = await get(`/${id}`);
      assert.equal(response.status, 404);
      assert.equal(body.message, "Product not found");
      assert.ok(body.correlationId);
      assert.equal(body.stack, undefined);
    }
  });

  test("empty collections and pages beyond results return 200", async () => {
    const empty = await get(`?category=missing-${randomUUID()}`);
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.body.items, []);
    assert.equal(empty.body.pagination.total, 0);
    assert.equal(empty.body.pagination.totalPages, 0);
    const beyond = await get(`?category=${slug}&page=2147483647&limit=100`);
    assert.equal(beyond.response.status, 200);
    assert.deepEqual(beyond.body.items, []);
    assert.equal(beyond.body.pagination.total, 3);
  });

  test("invalid UUID, bounds, types, repeated and unknown parameters return 400", async () => {
    for (const path of [
      "/not-a-uuid",
      "?page=0",
      "?page=1.5",
      "?page=2147483648",
      "?limit=101",
      "?limit=0",
      "?page=1e2",
      "?page=",
      "?page=1&page=2",
      "?q=",
      `?q=${"a".repeat(101)}`,
      "?category=Bad!",
      "?published=false",
    ]) {
      const { response, body } = await get(path);
      assert.equal(response.status, 400, path);
      assert.ok(body.correlationId);
    }
  });
});
