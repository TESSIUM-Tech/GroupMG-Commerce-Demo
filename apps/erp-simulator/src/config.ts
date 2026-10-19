import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(__dirname, "../../../.env"), quiet: true });

export interface SimulatorConfig {
  databaseUrl: string;
  port: number;
  demo: boolean;
  scenario: "normal" | "unavailable" | "timeout-before" | "timeout-after";
  latencyMs: number;
  timeoutMs: number;
}

function integer(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max)
    throw new Error("Invalid ERP numeric configuration");
  return parsed;
}

export function readConfig(env = process.env): SimulatorConfig {
  if (!env.ERP_DATABASE_URL) throw new Error("ERP_DATABASE_URL is required");
  const url = new URL(env.ERP_DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname) !== "/erp_demo"
  ) {
    throw new Error(
      "Simulator requires the dedicated erp_demo PostgreSQL database",
    );
  }
  const demo = env.ERP_ENV === "demo";
  const scenario = env.ERP_DEMO_SCENARIO ?? "normal";
  if (
    !["normal", "unavailable", "timeout-before", "timeout-after"].includes(
      scenario,
    )
  )
    throw new Error("Invalid ERP_DEMO_SCENARIO");
  const latencyMs = integer(env.ERP_DEMO_LATENCY_MS, 0, 60000);
  if (!demo && (scenario !== "normal" || latencyMs !== 0))
    throw new Error("Fault injection requires ERP_ENV=demo");
  const port = integer(env.ERP_PORT, 3003, 65535);
  if (!port) throw new Error("Invalid ERP_PORT");
  return {
    databaseUrl: env.ERP_DATABASE_URL,
    port,
    demo,
    scenario: scenario as SimulatorConfig["scenario"],
    latencyMs,
    timeoutMs: integer(env.ERP_DEMO_TIMEOUT_MS, 10000, 60000),
  };
}
