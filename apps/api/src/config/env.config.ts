export interface AppConfig {
  port: number;
  databaseUrl: string;
  nodeEnv: string;
  globalPrefix: string;
  allowDemoSeed: boolean;
}

/**
 * Redacts username/password credentials from a connection string for safe logging.
 */
export function maskConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    if (parsed.password || parsed.username) {
      parsed.password = "******";
      parsed.username = parsed.username ? "******" : "";
    }
    return parsed.toString();
  } catch {
    return "[invalid-connection-string-masked]";
  }
}

/**
 * Validates the runtime environment variables without logging or leaking credentials.
 */
export function validateEnv(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "Configuration validation error: DATABASE_URL is required.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(
      "Configuration validation error: DATABASE_URL must be a valid PostgreSQL connection URL.",
    );
  }

  const validProtocols = ["postgresql:", "postgres:"];
  if (!validProtocols.includes(parsedUrl.protocol)) {
    throw new Error(
      "Configuration validation error: DATABASE_URL must use postgresql: or postgres: protocol.",
    );
  }

  const rawPort = env.PORT ?? "3001";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "Configuration validation error: PORT must be an integer between 1 and 65535.",
    );
  }

  const nodeEnv = env.NODE_ENV ?? "development";
  const allowDemoSeed = env.ALLOW_DEMO_SEED === "true";

  return {
    port,
    databaseUrl,
    nodeEnv,
    globalPrefix: "api/v1",
    allowDemoSeed,
  };
}
