const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { execFileSync } = require("node:child_process");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
require("reflect-metadata");

const { NestFactory } = require("@nestjs/core");
const {
  ValidationPipe,
  ServiceUnavailableException,
} = require("@nestjs/common");
const { AppModule } = require("../dist/app.module");
const {
  validateEnv,
  maskConnectionString,
} = require("../dist/config/env.config");
const {
  HttpExceptionFilter,
} = require("../dist/common/filters/http-exception.filter");
const { PrismaService } = require("../dist/database/prisma.service");
const {
  CATALOG_REPOSITORY,
} = require("../dist/modules/catalog/domain/catalog.repository.port");

if (process.env.ALLOW_DB_TESTS !== "true") {
  throw new Error("Use ALLOW_DB_TESTS=true only in an isolated test database");
}
if (
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/commerce_issue2_test")
) {
  throw new Error("Tests require commerce_issue2_test database");
}

describe("Config Validation", () => {
  test("validateEnv succeeds with valid configuration", () => {
    const config = validateEnv({
      DATABASE_URL:
        "postgresql://commerce:secret@127.0.0.1:5432/commerce_issue2_test",
      PORT: "3005",
      NODE_ENV: "test",
    });
    assert.equal(config.port, 3005);
    assert.equal(config.globalPrefix, "api/v1");
  });

  test("validateEnv fails on missing DATABASE_URL without leaking secrets", () => {
    assert.throws(
      () => validateEnv({ PORT: "3001" }),
      (err) => {
        assert.match(err.message, /DATABASE_URL is required/);
        return true;
      },
    );
  });

  test("validateEnv fails on invalid DATABASE_URL protocol without leaking connection string", () => {
    const secretUrl = "mysql://user:super_secret_pw@127.0.0.1:3306/db";
    assert.throws(
      () => validateEnv({ DATABASE_URL: secretUrl }),
      (err) => {
        assert.doesNotMatch(err.message, /super_secret_pw/);
        assert.match(
          err.message,
          /DATABASE_URL must use postgresql: or postgres: protocol/,
        );
        return true;
      },
    );
  });

  test("validateEnv fails on invalid PORT", () => {
    assert.throws(
      () =>
        validateEnv({
          DATABASE_URL: "postgresql://commerce:pass@127.0.0.1:5432/test",
          PORT: "999999",
        }),
      (err) => {
        assert.match(
          err.message,
          /PORT must be an integer between 1 and 65535/,
        );
        return true;
      },
    );
  });

  test("maskConnectionString redacts user and password credentials", () => {
    const masked = maskConnectionString(
      "postgresql://admin:super_secret_password@127.0.0.1:5432/commerce",
    );
    assert.doesNotMatch(masked, /super_secret_password/);
    assert.match(masked, /\*\*\*\*\*\*/);
  });
});

describe("API Base Endpoints & HTTP Error Handling", () => {
  let app;
  let baseUrl;
  let prismaService;
  let catalogRepository;

  before(async () => {
    // This suite must also work on a newly migrated database, regardless of file order.
    execFileSync(process.execPath, [resolve(__dirname, "../prisma/seed.cjs")], {
      env: { ...process.env, ALLOW_DEMO_SEED: "true" },
      stdio: "pipe",
    });
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });

    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        stopAtFirstError: false,
        validationError: {
          target: false,
          value: false,
        },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableShutdownHooks();

    await app.listen(0, "127.0.0.1");
    const port = app.getHttpServer().address().port;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    prismaService = app.get(PrismaService);
    catalogRepository = app.get(CATALOG_REPOSITORY);
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  test("GET /health responds with 200 liveness and correlationId", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.service, "api");
    assert.equal(body.status, "ok");
    assert.equal(body.scope, "liveness");
    assert.ok(body.correlationId, "correlationId must be present in body");

    const headerCid = res.headers.get("x-correlation-id");
    assert.equal(
      headerCid,
      body.correlationId,
      "Header and body correlationId must match",
    );
  });

  test("GET /health/liveness alias responds with 200", async () => {
    const res = await fetch(`${baseUrl}/health/liveness`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.scope, "liveness");
    assert.equal(body.status, "ok");
  });

  test("Propagates incoming x-correlation-id header across responses", async () => {
    const customCid = "client-trace-req-987654";
    const res = await fetch(`${baseUrl}/health`, {
      headers: { "x-correlation-id": customCid },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-correlation-id"), customCid);

    const body = await res.json();
    assert.equal(body.correlationId, customCid);
  });

  test("GET /health/readiness succeeds when PostgreSQL is connected", async () => {
    const res = await fetch(`${baseUrl}/health/readiness`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.service, "api");
    assert.equal(body.status, "ok");
    assert.equal(body.scope, "readiness");
    assert.equal(body.checks?.database, "ok");
    assert.ok(body.correlationId);
  });

  test("GET /health/readiness returns 503 and consistent error without stack when database is down", async () => {
    // Temporarily mock ping to simulate database outage
    const originalPing = prismaService.ping;
    prismaService.ping = async () => false;

    try {
      const res = await fetch(`${baseUrl}/health/readiness`);
      assert.equal(
        res.status,
        503,
        "Readiness must return 503 when database is not available",
      );

      const body = await res.json();
      assert.equal(body.statusCode, 503);
      assert.equal(body.error, "Service Unavailable");
      assert.equal(body.service, "api");
      assert.equal(body.scope, "readiness");
      assert.equal(body.checks?.database, "down");
      assert.ok(body.correlationId);

      // Verify no internal stack traces or connection strings are leaked
      assert.equal(
        body.stack,
        undefined,
        "Stack trace must not be leaked in response",
      );
      assert.doesNotMatch(JSON.stringify(body), /commerce_issue2_test/);
      assert.doesNotMatch(JSON.stringify(body), /password/i);

      // Verify liveness still succeeds during database downtime
      const livenessRes = await fetch(`${baseUrl}/health`);
      assert.equal(
        livenessRes.status,
        200,
        "Liveness must remain 200 when database is down",
      );
      const livenessBody = await livenessRes.json();
      assert.equal(livenessBody.status, "ok");
      assert.equal(livenessBody.scope, "liveness");
    } finally {
      prismaService.ping = originalPing;
    }
  });

  test("POST /health/validate succeeds with valid DTO payload", async () => {
    const res = await fetch(`${baseUrl}/health/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ echo: "ping-test", repeat: 2 }),
    });
    assert.equal(res.status, 201);

    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.validated, true);
    assert.equal(body.data.echo, "ping-test");
    assert.equal(body.data.repeat, 2);
    assert.ok(body.correlationId);
  });

  test("POST /health/validate rejects invalid DTO property types with 400 and no stack trace", async () => {
    const res = await fetch(`${baseUrl}/health/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ echo: 12345 }), // echo must be a string
    });
    assert.equal(res.status, 400);

    const body = await res.json();
    assert.equal(body.statusCode, 400);
    assert.equal(body.error, "Bad Request");
    assert.ok(
      Array.isArray(body.message),
      "Validation errors must be formatted as an array",
    );
    assert.ok(
      body.message.some((msg) => msg.includes("echo must be a string")),
    );
    assert.ok(body.correlationId);
    assert.ok(body.timestamp);
    assert.equal(body.path, "/api/v1/health/validate");
    assert.equal(body.stack, undefined, "Stack trace must not be leaked");
  });

  test("POST /health/validate rejects disallowed / unwhitelisted fields with 400 and no stack trace", async () => {
    const res = await fetch(`${baseUrl}/health/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        echo: "valid-echo",
        unexpectedField: "unallowed",
        maliciousPayload: 999,
      }),
    });
    assert.equal(res.status, 400);

    const body = await res.json();
    assert.equal(body.statusCode, 400);
    assert.equal(body.error, "Bad Request");
    assert.ok(Array.isArray(body.message));
    assert.ok(
      body.message.some((msg) =>
        msg.includes("property unexpectedField should not exist"),
      ),
      "Must reject unexpectedField",
    );
    assert.ok(
      body.message.some((msg) =>
        msg.includes("property maliciousPayload should not exist"),
      ),
      "Must reject maliciousPayload",
    );
    assert.equal(body.stack, undefined, "Stack trace must not be leaked");
  });

  test("PostgreSQL CatalogRepository connects and queries database products", async () => {
    const ready = await catalogRepository.isReady();
    assert.equal(ready, true, "CatalogRepository must report ready");

    const count = await catalogRepository.countProducts();
    assert.equal(
      count,
      12,
      "CatalogRepository must find 12 seeded demo products",
    );
  });
});
