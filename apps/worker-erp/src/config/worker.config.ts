export const WORKER_CONFIG = Symbol("WORKER_CONFIG");

/** "none" until DEMO-11 provides a real (simulated) ERP adapter. */
export type ErpAdapterName = "none";

export interface WorkerConfig {
  databaseUrl: string | null;
  rabbitmqUrl: string | null;
  erpAdapter: ErpAdapterName;
}

export class WorkerConfigError extends Error {
  constructor(problems: string[]) {
    super(`Worker configuration invalid: ${problems.join("; ")}`);
    this.name = "WorkerConfigError";
  }
}

const ADAPTERS: readonly ErpAdapterName[] = ["none"];

/**
 * Consumption needs PostgreSQL (export records), RabbitMQ and an ERP adapter.
 * Without any of them the worker stays idle and sales wait in the durable
 * queue. URLs are validated but never echoed: they carry credentials.
 */
export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const problems: string[] = [];
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const rabbitmqUrl = env.RABBITMQ_URL?.trim() || null;
  const erpAdapter = (env.ERP_ADAPTER?.trim() || "none") as ErpAdapterName;

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
  return { databaseUrl, rabbitmqUrl, erpAdapter };
}

function protocolOf(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return "invalid:";
  }
}
