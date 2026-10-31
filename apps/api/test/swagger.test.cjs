const { test } = require("node:test");
const assert = require("node:assert/strict");
require("reflect-metadata");
const { Module } = require("@nestjs/common");
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
const { HealthController } = require("../dist/health/health.controller");
const { PrismaService } = require("../dist/database/prisma.service");
const { setupSwagger } = require("../dist/documentation/swagger");

test("Swagger serves all implemented routes, request constraints and response schemas without PostgreSQL", async () => {
  class TestModule {}
  Module({
    controllers: [ProductsController, HealthController],
    providers: [
      { provide: ListProductsUseCase, useValue: {} },
      { provide: GetProductUseCase, useValue: {} },
      { provide: PrismaService, useValue: {} },
    ],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  try {
    app.setGlobalPrefix("api/v1");
    setupSwagger(app);
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const response = await fetch(`${base}/api/docs-json`);
    assert.equal(response.status, 200);
    const spec = await response.json();
    assert.deepEqual(
      Object.keys(spec.paths).sort(),
      [
        "/api/v1/health",
        "/api/v1/health/liveness",
        "/api/v1/health/readiness",
        "/api/v1/health/validate",
        "/api/v1/products",
        "/api/v1/products/{id}",
      ].sort(),
    );
    const list = spec.paths["/api/v1/products"].get;
    const limit = list.parameters.find((p) => p.name === "limit");
    assert.equal(limit.schema.maximum, 100);
    assert.equal(limit.schema.default, 20);
    assert.ok(
      list.parameters.some((p) => p.name === "x-correlation-id" && !p.required),
    );
    assert.equal(
      list.responses[200].content["application/json"].schema.$ref,
      "#/components/schemas/ProductListResponseDto",
    );
    const detail = spec.paths["/api/v1/products/{id}"].get;
    assert.equal(
      detail.parameters.find((p) => p.name === "id").schema.format,
      "uuid",
    );
    assert.ok(detail.responses[400]);
    assert.ok(detail.responses[404]);
    assert.ok(spec.paths["/api/v1/health/readiness"].get.responses[503]);
    const validation = spec.paths["/api/v1/health/validate"].post;
    assert.ok(validation.responses[201]);
    assert.equal(
      validation.requestBody.content["application/json"].schema.$ref,
      "#/components/schemas/HealthValidateDto",
    );
    assert.deepEqual(spec.components.schemas.HealthValidateDto.required, [
      "echo",
    ]);
    assert.equal(
      spec.components.schemas.HealthValidateDto.properties.repeat.maximum,
      100,
    );
    assert.equal(
      spec.components.schemas.ProductResponseDto.properties.priceMinor.type,
      "integer",
    );
    const ui = await fetch(`${base}/api/docs/`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger-ui/);
  } finally {
    await app.close();
  }
});
