export const WORKER_CONFIG = Symbol("WORKER_CONFIG");

/** simulated: DEMO-11 ERP simulator (default); none: no ERP, do not consume. */
export type ErpAdapterName = "simulated" | "none";

export interface WorkerConfig {
  databaseUrl: string | null;
  rabbitmqUrl: string | null;
  erpAdapter: ErpAdapterName;
  /** Simulated ERP connection (docs/erp-simulator.md); the adapter validates it. */
  erpBaseUrl: string;
  erpTimeoutMs: number;
  erpPageSize: number;
}

export class WorkerConfigError extends Error {
  constructor(problems: string[]) {
    super(`Worker configuration invalid: ${problems.join("; ")}`);
    this.name = "WorkerConfigError";
  }
}

const ADAPTERS: readonly ErpAdapterName[] = ["simulated", "none"];

/**
 * Sales export needs PostgreSQL (export records), RabbitMQ and an ERP adapter.
 * Without the database or the broker, or with ERP_ADAPTER=none, the worker
 * stays idle and sales wait in the durable queue. URLs are validated but never
 * echoed: they may carry credentials.
 */
export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const problems: string[] = [];
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const rabbitmqUrl = env.RABBITMQ_URL?.trim() || null;
  const erpAdapter = (env.ERP_ADAPTER?.trim() || "simulated") as ErpAdapterName;

  if (databaseUrl && !/^postgres(ql)?:$/.test(protocolOf(databaseUrl))) {
    problems.push("DATABASE_URL must be a postgresql: URL");
  }
  if (rabbitmqUrl && !/^amqps?:$/.test(protocolOf(rabbitmqUrl))) {
    problems.push("RABBITMQ_URL must be an amqp: or amqps: URL");
  }
  if (!ADAPTERS.includes(erpAdapter)) {
    problems.push(`ERP_ADAPTER must be one of: ${ADAPTERS.join(", ")}`);
  }
  if (problems.length > 0) throw new WorkerConfigError(problems);
  return {
    databaseUrl,
    rabbitmqUrl,
    erpAdapter,
    // Same defaults DEMO-11 used in AppModule.
    erpBaseUrl: env.ERP_BASE_URL?.trim() || "http://127.0.0.1:3003",
    erpTimeoutMs: Number(env.ERP_TIMEOUT_MS ?? 3000),
    erpPageSize: Number(env.ERP_PAGE_SIZE ?? 20),
  };
}

function protocolOf(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return "invalid:";
  }
}
