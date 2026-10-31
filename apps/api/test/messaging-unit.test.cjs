const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  loadMessagingConfig,
  MessagingConfigError,
} = require("../dist/messaging/messaging.config");
const { ERP_SALES_TOPOLOGY } = require("../dist/messaging/rabbitmq-topology");

test("messaging is optional: without RABBITMQ_URL the outbox just waits", () => {
  assert.deepEqual(loadMessagingConfig({}), { rabbitmqUrl: null });
  assert.deepEqual(loadMessagingConfig({ RABBITMQ_URL: "  " }), {
    rabbitmqUrl: null,
  });
  assert.equal(
    loadMessagingConfig({ RABBITMQ_URL: "amqp://u:p@127.0.0.1:5672" })
      .rabbitmqUrl,
    "amqp://u:p@127.0.0.1:5672",
  );
});

test("invalid broker URLs are rejected without echoing credentials", () => {
  for (const url of ["not a url", "http://u:secret-pass@host:5672"]) {
    assert.throws(
      () => loadMessagingConfig({ RABBITMQ_URL: url }),
      (error) =>
        error instanceof MessagingConfigError &&
        !error.message.includes("secret-pass"),
    );
  }
});

test("the topology follows docs/architecture.md", () => {
  assert.deepEqual(ERP_SALES_TOPOLOGY, {
    exchange: "commerce.events",
    routingKey: "order.confirmed.v1",
    queue: "erp.sales.v1",
    retryQueue: "erp.sales.v1.retry",
    deadLetterQueue: "erp.sales.dlq",
    retryDelayMs: 30_000,
    maxDeliveryAttempts: 5,
  });
});
