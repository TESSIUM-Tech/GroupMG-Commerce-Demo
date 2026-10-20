export const MESSAGING_CONFIG = Symbol("MESSAGING_CONFIG");

export interface MessagingConfig {
  /** null: messaging disabled; outbox events wait in PostgreSQL. */
  rabbitmqUrl: string | null;
}

export class MessagingConfigError extends Error {
  constructor(message: string) {
    super(`Messaging configuration invalid: ${message}`);
    this.name = "MessagingConfigError";
  }
}

/**
 * RABBITMQ_URL is optional so the API keeps starting without a broker: the
 * outbox then simply accumulates until messaging is configured. The URL is
 * validated but never echoed, since it carries credentials.
 */
export function loadMessagingConfig(
  env: Record<string, string | undefined> = process.env,
): MessagingConfig {
  const raw = env.RABBITMQ_URL?.trim();
  if (!raw) return { rabbitmqUrl: null };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MessagingConfigError("RABBITMQ_URL must be a valid URL");
  }
  if (url.protocol !== "amqp:" && url.protocol !== "amqps:") {
    throw new MessagingConfigError("RABBITMQ_URL must use amqp: or amqps:");
  }
  return { rabbitmqUrl: raw };
}
