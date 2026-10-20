import { Module } from "@nestjs/common";
import {
  MESSAGING_CONFIG,
  MessagingConfigError,
  loadMessagingConfig,
} from "./messaging.config";
import { OutboxPublisherScheduler } from "./outbox-publisher.scheduler";

@Module({
  providers: [
    {
      provide: MESSAGING_CONFIG,
      useFactory: () => {
        try {
          return loadMessagingConfig(process.env);
        } catch (error) {
          // main.ts prints a generic message; name the problem, never the URL.
          if (error instanceof MessagingConfigError) {
            console.error(`[API] ${error.message}`);
          }
          throw error;
        }
      },
    },
    OutboxPublisherScheduler,
  ],
})
export class MessagingModule {}
