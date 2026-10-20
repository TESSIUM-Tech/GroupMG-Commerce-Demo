import type { Channel } from "amqplib";

/**
 * RabbitMQ topology for exporting sales to the ERP (docs/architecture.md):
 *
 *   commerce.events (topic) --order.confirmed.v1--> erp.sales.v1 --> worker
 *   erp.sales.v1   --nack--> erp.sales.v1.retry --TTL--> erp.sales.v1
 *   after maxDeliveryAttempts or an invalid event      --> erp.sales.dlq
 *
 * Retries go back through the default exchange to the sales queue only, so
 * other future subscribers of order.confirmed.v1 never get duplicates.
 * The same definition lives in apps/worker-erp; both sides declare it so the
 * queue exists (and keeps sales) even before the worker starts.
 */
export interface ErpSalesTopology {
  exchange: string;
  routingKey: string;
  queue: string;
  retryQueue: string;
  deadLetterQueue: string;
  retryDelayMs: number;
  maxDeliveryAttempts: number;
}

export const ERP_SALES_TOPOLOGY: ErpSalesTopology = {
  exchange: "commerce.events",
  routingKey: "order.confirmed.v1",
  queue: "erp.sales.v1",
  retryQueue: "erp.sales.v1.retry",
  deadLetterQueue: "erp.sales.dlq",
  retryDelayMs: 30_000,
  maxDeliveryAttempts: 5,
};

/** Idempotent: declaring the same durable entities again is a no-op. */
export async function assertErpSalesTopology(
  channel: Channel,
  topology: ErpSalesTopology = ERP_SALES_TOPOLOGY,
): Promise<void> {
  await channel.assertExchange(topology.exchange, "topic", { durable: true });
  await channel.assertQueue(topology.queue, {
    durable: true,
    arguments: {
      "x-queue-type": "classic",
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": topology.retryQueue,
    },
  });
  await channel.bindQueue(
    topology.queue,
    topology.exchange,
    topology.routingKey,
  );
  await channel.assertQueue(topology.retryQueue, {
    durable: true,
    arguments: {
      "x-queue-type": "classic",
      "x-message-ttl": topology.retryDelayMs,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": topology.queue,
    },
  });
  await channel.assertQueue(topology.deadLetterQueue, {
    durable: true,
    arguments: { "x-queue-type": "classic" },
  });
}
