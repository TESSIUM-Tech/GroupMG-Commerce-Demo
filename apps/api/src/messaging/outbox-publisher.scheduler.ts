import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { MESSAGING_CONFIG, type MessagingConfig } from "./messaging.config";
import { OutboxPublisher } from "./outbox-publisher";
import { RabbitMqPublisherChannel } from "./rabbitmq-publisher-channel";
import { ERP_SALES_TOPOLOGY } from "./rabbitmq-topology";

const PUBLISH_INTERVAL_MS = 2_000;

/** Relays the outbox every 2 s; idle when RABBITMQ_URL is not configured. */
@Injectable()
export class OutboxPublisherScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private channel?: RabbitMqPublisherChannel;
  private publisher?: OutboxPublisher;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGING_CONFIG) private readonly config: MessagingConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.rabbitmqUrl) return;
    this.channel = new RabbitMqPublisherChannel(
      this.config.rabbitmqUrl,
      ERP_SALES_TOPOLOGY,
    );
    this.publisher = new OutboxPublisher(
      this.prisma,
      this.channel,
      ERP_SALES_TOPOLOGY,
    );
    this.timer = setInterval(() => void this.run(), PUBLISH_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.channel?.close();
  }

  private async run(): Promise<void> {
    if (this.running || !this.publisher) return;
    this.running = true;
    try {
      const summary = await this.publisher.publishPending();
      if (summary.published > 0 || summary.stopped) {
        console.log(
          `[API] Outbox relay: published=${summary.published}${summary.stopped ? " (stopped: RabbitMQ unavailable, retrying)" : ""}`,
        );
      }
    } catch {
      console.error("[API] Outbox relay failed; it will retry shortly");
    } finally {
      this.running = false;
    }
  }
}
