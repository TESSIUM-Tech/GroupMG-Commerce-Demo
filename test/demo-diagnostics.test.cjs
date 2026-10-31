const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { execSync } = require("node:child_process");
const { resolve } = require("node:path");
const { maskUrl, probeHttp } = require("../scripts/demo-diagnostics.cjs");

test("DEMO-14: maskUrl masks database and broker credentials", () => {
  assert.equal(
    maskUrl("postgresql://commerce:supersecret@127.0.0.1:5432/commerce"),
    "postgresql://commerce:******@127.0.0.1:5432/commerce",
  );
  assert.equal(
    maskUrl("amqp://admin:topsecretpass@127.0.0.1:5672"),
    "amqp://admin:******@127.0.0.1:5672",
  );
  assert.equal(
    maskUrl("http://127.0.0.1:3000/health"),
    "http://127.0.0.1:3000/health",
  );
  assert.equal(maskUrl("not-a-valid-url"), "[URL no válida o incompleta]");
});

test("DEMO-14: probeHttp handles active endpoints and connection errors gracefully", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const success = await probeHttp(`http://127.0.0.1:${port}/health`);
    assert.equal(success.ok, true);
    assert.equal(success.statusCode, 200);

    const notFound = await probeHttp(`http://127.0.0.1:${port}/missing`);
    assert.equal(notFound.ok, false);
    assert.equal(notFound.statusCode, 404);

    const unreachable = await probeHttp("http://127.0.0.1:65534/test");
    assert.equal(unreachable.ok, false);
    assert.ok(unreachable.error);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("DEMO-14: demo-reset requires explicit --confirm-demo-reset flag", () => {
  const scriptPath = resolve(__dirname, "../scripts/demo-reset.cjs");
  assert.throws(
    () => {
      execSync(`node "${scriptPath}"`, { stdio: "pipe" });
    },
    (err) => {
      assert.equal(err.status, 1);
      const stderr = err.stderr.toString("utf8");
      assert.ok(stderr.includes("--confirm-demo-reset"));
      return true;
    },
  );
});
