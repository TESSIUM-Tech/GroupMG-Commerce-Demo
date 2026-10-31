const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
const amqp = require("amqplib");
const {
  assertErpSalesTopology,
} = require("../dist/messaging/rabbitmq-topology");

if (process.env.ALLOW_RABBITMQ_TESTS !== "true" || !process.env.RABBITMQ_URL) {
  throw new Error(
    "Messaging tests require a local RabbitMQ, RABBITMQ_URL and ALLOW_RABBITMQ_TESTS=true",
  );
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

describe("RabbitMQ topology for ERP sales", () => {
  const suffix = randomUUID().slice(0, 8);
  // Own names and a short retry delay so real queues are never touched.
  const topology = {
    exchange: `test.commerce.events.${suffix}`,
    routingKey: "order.confirmed.v1",
    queue: `test.erp.sales.${suffix}`,
    retryQueue: `test.erp.sales.${suffix}.retry`,
    deadLetterQueue: `test.erp.sales.${suffix}.dlq`,
    retryDelayMs: 300,
    maxDeliveryAttempts: 3,
  };
  let connection, channel;

  before(async () => {
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createConfirmChannel();
    await assertErpSalesTopology(channel, topology);
  });

  after(async () => {
    try {
      for (const queue of [
        topology.queue,
        topology.retryQueue,
        topology.deadLetterQueue,
      ]) {
        await channel.deleteQueue(queue);
      }
      await channel.deleteExchange(topology.exchange);
      await channel.close();
    } finally {
      await connection.close();
    }
  });

  async function management(path) {
    const url = new URL(process.env.RABBITMQ_URL);
    const response = await fetch(`http://${url.hostname}:15672/api${path}`, {
      headers: {
        authorization: `Basic ${Buffer.from(
          `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
        ).toString("base64")}`,
      },
    });
    assert.equal(response.status, 200, path);
    return response.json();
  }

  test("exchange and queues are durable and declaring them again is harmless", async () => {
    await assertErpSalesTopology(channel, topology);
    const exchange = await management(`/exchanges/%2F/${topology.exchange}`);
    assert.equal(exchange.type, "topic");
    assert.equal(exchange.durable, true);
    for (const name of [
      topology.queue,
      topology.retryQueue,
      topology.deadLetterQueue,
    ]) {
      const queue = await management(`/queues/%2F/${name}`);
      assert.equal(queue.durable, true, name);
      assert.equal(queue.auto_delete, false, name);
    }
    const main = await management(`/queues/%2F/${topology.queue}`);
    assert.equal(
      main.arguments["x-dead-letter-routing-key"],
      topology.retryQueue,
    );
    const retry = await management(`/queues/%2F/${topology.retryQueue}`);
    assert.equal(retry.arguments["x-message-ttl"], 300);
    assert.equal(retry.arguments["x-dead-letter-routing-key"], topology.queue);
  });

  test("order.confirmed.v1 is routed to the sales queue as a persistent message", async () => {
    const eventId = randomUUID();
    await new Promise((done, fail) =>
      channel.publish(
        topology.exchange,
        topology.routingKey,
        Buffer.from(JSON.stringify({ eventId })),
        { persistent: true, mandatory: true, messageId: eventId },
        (error) => (error ? fail(error) : done()),
      ),
    );
    const message = await channel.get(topology.queue, { noAck: false });
    assert.ok(message, "message must reach the sales queue");
    assert.equal(message.properties.messageId, eventId);
    assert.equal(message.properties.deliveryMode, 2);
    channel.ack(message);
  });

  test("a message without a route is returned instead of silently lost", async () => {
    const returned = new Promise((done) => channel.once("return", done));
    await new Promise((done, fail) =>
      channel.publish(
        topology.exchange,
        "no.such.route",
        Buffer.from("{}"),
        { persistent: true, mandatory: true },
        (error) => (error ? fail(error) : done()),
      ),
    );
    const message = await Promise.race([
      returned,
      sleep(2000).then(() => null),
    ]);
    assert.ok(message, "unroutable message must be returned");
    assert.equal(message.fields.routingKey, "no.such.route");
  });

  test("a rejected message waits in the retry queue and comes back to the sales queue only", async () => {
    const eventId = randomUUID();
    await new Promise((done, fail) =>
      channel.publish(
        topology.exchange,
        topology.routingKey,
        Buffer.from(JSON.stringify({ eventId })),
        { persistent: true, mandatory: true, messageId: eventId },
        (error) => (error ? fail(error) : done()),
      ),
    );
    const first = await channel.get(topology.queue, { noAck: false });
    channel.nack(first, false, false);
    await sleep(50);
    // checkQueue is real time; management statistics lag by a few seconds.
    const waiting = await channel.checkQueue(topology.retryQueue);
    assert.equal(waiting.messageCount, 1, "message parked in the retry queue");
    let back = false;
    for (let i = 0; i < 30 && !back; i += 1) {
      await sleep(100);
      back = await channel.get(topology.queue, { noAck: false });
    }
    assert.ok(back, "message returns after the retry delay");
    assert.equal(back.properties.messageId, eventId);
    const death = back.properties.headers["x-death"];
    assert.ok(Array.isArray(death));
    const rejected = death.find(
      (entry) => entry.queue === topology.queue && entry.reason === "rejected",
    );
    assert.equal(rejected.count, 1, "x-death counts delivery attempts");
    channel.ack(back);
  });
});
