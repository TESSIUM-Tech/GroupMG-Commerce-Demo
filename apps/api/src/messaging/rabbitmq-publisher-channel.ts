import { connect, type ChannelModel, type ConfirmChannel } from "amqplib";
import {
  assertErpSalesTopology,
  type ErpSalesTopology,
} from "./rabbitmq-topology";

const CONFIRM_TIMEOUT_MS = 10_000;

export interface PublishRequest {
  exchange: string;
  routingKey: string;
  body: Buffer;
  messageId: string;
  type: string;
  correlationId?: string;
}

/** The broker refused or could not be reached; the event stays pending. */
export class PublishFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishFailedError";
  }
}

/** Something that can publish with broker confirmation (real or test double). */
export interface ConfirmedPublisher {
  publish(request: PublishRequest): Promise<void>;
  close(): Promise<void>;
}

/**
 * One confirm channel, opened lazily and reopened after any failure. A publish
 * resolves only when RabbitMQ confirms it; a mandatory message that had no
 * route (basic.return precedes its ack) is reported as a failure.
 */
export class RabbitMqPublisherChannel implements ConfirmedPublisher {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private readonly returned = new Set<string>();

  constructor(
    private readonly url: string,
    private readonly topology: ErpSalesTopology,
  ) {}

  async publish(request: PublishRequest): Promise<void> {
    const channel = await this.open();
    this.returned.delete(request.messageId);
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(
        () => fail(new PublishFailedError("RabbitMQ did not confirm in time")),
        CONFIRM_TIMEOUT_MS,
      );
      try {
        channel.publish(
          request.exchange,
          request.routingKey,
          request.body,
          {
            persistent: true,
            mandatory: true,
            messageId: request.messageId,
            type: request.type,
            contentType: "application/json",
            appId: "groupmg-api",
            timestamp: Math.floor(Date.now() / 1000),
            ...(request.correlationId
              ? { correlationId: request.correlationId }
              : {}),
          },
          (error) => {
            clearTimeout(timer);
            if (error)
              fail(new PublishFailedError("RabbitMQ rejected the message"));
            else done();
          },
        );
      } catch {
        clearTimeout(timer);
        fail(new PublishFailedError("RabbitMQ channel unavailable"));
      }
    }).catch(async (error: unknown) => {
      await this.reset();
      throw error;
    });
    if (this.returned.delete(request.messageId)) {
      throw new PublishFailedError(
        `No queue is bound for ${request.exchange}/${request.routingKey}`,
      );
    }
  }

  async close(): Promise<void> {
    await this.reset();
  }

  private async open(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    try {
      const connection = await connect(this.url);
      this.connection = connection;
      connection.on("error", () => void this.reset());
      connection.on("close", () => {
        this.connection = null;
        this.channel = null;
      });
      const channel = await connection.createConfirmChannel();
      channel.on("error", () => void this.reset());
      channel.on("return", (message) => {
        const id = message.properties.messageId;
        if (typeof id === "string") this.returned.add(id);
      });
      await assertErpSalesTopology(channel, this.topology);
      this.channel = channel;
      return channel;
    } catch {
      await this.reset();
      // Never echo the URL: it carries credentials.
      throw new PublishFailedError("RabbitMQ is not reachable");
    }
  }

  private async reset(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.channel = null;
    if (connection) await connection.close().catch(() => undefined);
  }
}
