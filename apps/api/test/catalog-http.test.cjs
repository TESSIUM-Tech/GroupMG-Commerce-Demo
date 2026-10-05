const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("reflect-metadata");
const { Module, ValidationPipe } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const {
  ProductsController,
} = require("../dist/modules/catalog/presentation/products.controller");
const {
  ListProductsUseCase,
} = require("../dist/modules/catalog/application/list-products.use-case");
const {
  GetProductUseCase,
} = require("../dist/modules/catalog/application/get-product.use-case");
const {
  CorrelationIdMiddleware,
} = require("../dist/common/middleware/correlation-id.middleware");
const {
  HttpExceptionFilter,
} = require("../dist/common/filters/http-exception.filter");

describe("Catalog HTTP boundary without database", () => {
  let app, url, lastQuery;
  const repository = {
    listPublished: async (query) => {
      lastQuery = query;
      return { items: [], total: 0 };
    },
    findPublishedById: async () => null,
  };
  before(async () => {
    class TestModule {}
    Module({
      controllers: [ProductsController],
      providers: [
        {
          provide: ListProductsUseCase,
          useValue: new ListProductsUseCase(repository),
        },
        {
          provide: GetProductUseCase,
          useValue: new GetProductUseCase(repository),
        },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.setGlobalPrefix("api/v1");
    app.use(
      new CorrelationIdMiddleware().use.bind(new CorrelationIdMiddleware()),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/products`;
  });
  after(async () => {
    if (app) await app.close();
  });

  test("defaults, decimal parsing, trimming and correlation reach the HTTP contract", async () => {
    const response = await fetch(url);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.items, []);
    assert.deepEqual(body.pagination, {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    assert.equal(body.correlationId, response.headers.get("x-correlation-id"));
    await fetch(`${url}?page=2&limit=3&q=%20Phone%20&category=audio`);
    assert.deepEqual(
      { ...lastQuery },
      { page: 2, limit: 3, q: "Phone", category: "audio" },
    );
  });

  test("rejects malformed, excessive, repeated and unknown filters", async () => {
    for (const query of [
      "page=0",
      "page=1.5",
      "page=1e2",
      "page=",
      "page=2147483648",
      "limit=0",
      "limit=101",
      "page=1&page=2",
      "q=",
      "q=%20",
      `q=${"x".repeat(101)}`,
      "category=Bad!",
      "category=audio&category=other",
      "q=one&q=two",
      "published=false",
    ]) {
      const response = await fetch(`${url}?${query}`);
      assert.equal(response.status, 400, query);
      const body = await response.json();
      assert.ok(body.correlationId);
      assert.equal(body.stack, undefined);
    }
  });

  test("invalid identifiers return 400 and missing products return 404", async () => {
    assert.equal((await fetch(`${url}/invalid`)).status, 400);
    const response = await fetch(`${url}/00000000-0000-4000-8000-000000000001`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).message, "Product not found");
  });
});
