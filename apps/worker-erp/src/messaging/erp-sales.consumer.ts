import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";
import type {
  ExportDecision,
  ExportSaleUseCase,
} from "../exports/export-sale.use-case";
import {
  assertErpSalesTopology,
  type ErpSalesTopology,
} from "./rabbitmq-topology";

const RECONNECT_DELAY_MS = 5_000;
const CONFIRM_TIMEOUT_MS = 10_000;

export interface ConsumerLog {
  (line: string): void;
}

/**
 * Consumes erp.sales.v1 one message at a time and applies the export
 * decision. Every message is acked only after its outcome is persisted:
 * ack (exported or duplicate), nack to the retry queue, or a confirmed copy
 * in the DLQ followed by the ack. Unexpected errors nack, so nothing is lost;
 * a crash before the ack makes RabbitMQ redeliver it.
 */
export class ErpSalesConsumer {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private consumerTag: string | null = null;
  private stopping = false;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private readonly url: string,
    private readonly topology: ErpSalesTopology,
    private readonly exportSale: ExportSaleUseCase,
    private readonly log: ConsumerLog = (line) => console.log(line),
  ) {}

  async start(): Promise<void> {
    this.stopping = false;
    const connection = await connect(this.url);
    this.connection = connection;
    connection.on("error", () => undefined);
    connection.on("close", () => {
      this.connection = null;
      this.channel = null;
      this.consumerTag = null;
      if (!this.stopping) this.scheduleReconnect();
    });
    const channel = await connection.createConfirmChannel();
    channel.on("error", () => undefined);
    await assertErpSalesTopology(channel, this.topology);
    await channel.prefetch(1);
    this.channel = channel;
    const { consumerTag } = await channel.consume(
      this.topology.queue,
      (message) => {
        if (message) void this.handle(channel, message);
      },
      { noAck: false },
    );
    this.consumerTag = consumerTag;
  }

  /** Like start(), but keeps retrying while RabbitMQ is not reachable yet. */
  startWithRetry(): void {
    this.stopping = false;
    this.start().catch(() => this.scheduleReconnect());
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const { channel, connection, consumerTag } = this;
    this.channel = null;
    this.connection = null;
    this.consumerTag = null;
    if (channel && consumerTag)
      await channel.cancel(consumerTag).catch(() => undefined);
    if (connection) await connection.close().catch(() => undefined);
  }

  private scheduleReconnect(): void {
    this.log("[worker] RabbitMQ connection lost; reconnecting in 5 s");
    this.reconnectTimer = setTimeout(() => {
      if (this.stopping) return;
      this.start().catch(() => this.scheduleReconnect());
    }, RECONNECT_DELAY_MS);
    this.reconnectTimer.unref();
  }

  /** 1 for the first delivery; each pass through the retry queue adds one. */
  private deliveryCount(message: ConsumeMessage): number {
    const deaths = message.properties.headers?.["x-death"];
    if (!Array.isArray(deaths)) return 1;
    const rejected = deaths.find(
      (entry: { queue?: string; reason?: string }) =>
        entry.queue === this.topology.queue && entry.reason === "rejected",
    ) as { count?: number } | undefined;
    return 1 + Number(rejected?.count ?? 0);
  }

  private async handle(
    channel: ConfirmChannel,
    message: ConsumeMessage,
  ): Promise<void> {
    const deliveryCount = this.deliveryCount(message);
    const messageId =
      typeof message.properties.messageId === "string"
        ? message.properties.messageId
        : undefined;
    let decision: ExportDecision;
    try {
      decision = await this.exportSale.execute({
        body: message.content,
        messageId,
        deliveryCount,
      });
    } catch {
      // No persisted outcome (e.g. database down): never ack, retry later.
      this.log(
        `[worker] Sale ${messageId ?? "?"} could not be recorded; will retry`,
      );
      this.settle(() => channel.nack(message, false, false));
      return;
    }
    if (decision.action === "ack") {
      this.log(`[worker] Sale ${messageId} ${decision.reason}`);
      this.settle(() => channel.ack(message));
      return;
    }
    if (decision.action === "retry") {
      this.log(
        `[worker] Sale ${messageId} attempt ${deliveryCount} failed: ${decision.reason}`,
      );
      this.settle(() => channel.nack(message, false, false));
      return;
    }
    try {
      await this.publishToDeadLetter(
        channel,
        message,
        decision.reason,
        deliveryCount,
      );
      this.log(
        `[worker] Sale ${messageId ?? "?"} sent to DLQ: ${decision.reason}`,
      );
      this.settle(() => channel.ack(message));
    } catch {
      this.settle(() => channel.nack(message, false, false));
    }
  }

  /** Copy with the original body and properties plus the reason, confirmed. */
  private publishToDeadLetter(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    reason: string,
    deliveryCount: number,
  ): Promise<void> {
    const { properties } = message;
    return new Promise<void>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error("DLQ publish not confirmed")),
        CONFIRM_TIMEOUT_MS,
      );
      channel.sendToQueue(
        this.topology.deadLetterQueue,
        message.content,
        {
          persistent: true,
          messageId: properties.messageId,
          type: properties.type,
          contentType: properties.contentType,
          correlationId: properties.correlationId,
          timestamp: properties.timestamp,
          appId: properties.appId,
          headers: {
            ...(properties.headers ?? {}),
            "x-dlq-reason": reason.slice(0, 500),
            "x-dlq-at": new Date().toISOString(),
            "x-dlq-delivery-count": deliveryCount,
            "x-original-queue": this.topology.queue,
          },
        },
        (error) => {
          clearTimeout(timer);
          if (error) fail(error);
          else done();
        },
      );
    });
  }

  /** ack/nack on a closed channel throws; RabbitMQ then redelivers anyway. */
  private settle(action: () => void): void {
    try {
      action();
    } catch {
      // The message stays unacked and returns to the queue.
    }
  }
}
