import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { readConfig } from "../config";
import { PostgresStore } from "../persistence/store";

export function requireDemoAction(
  config: { demo: boolean },
  args: string[],
): "seed" | "reset" {
  if (!config.demo) throw new Error("Data management requires ERP_ENV=demo");
  const action = args[0];
  if (action !== "seed" && action !== "reset")
    throw new Error("Use seed or reset");
  if (action === "reset" && !args.includes("--confirm-erp-demo-reset"))
    throw new Error("Reset requires --confirm-erp-demo-reset");
  return action;
}

async function run() {
  const config = readConfig();
  const action = requireDemoAction(config, process.argv.slice(2));
  const raw: unknown = JSON.parse(
    (
      await readFile(
        resolve(__dirname, "../../../../docs/demo-products.json"),
        "utf8",
      )
    ).replace(/^\uFEFF/, ""),
  );
  if (
    !Array.isArray(raw) ||
    raw.some(
      (r) =>
        !r ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(r.sku) ||
        !Number.isSafeInteger(r.stock) ||
        r.stock < 0 ||
        r.stock > 2147483647,
    ) ||
    new Set(raw.map((r) => r.sku)).size !== raw.length
  )
    throw new Error("Invalid demo inventory fixture");
  const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 3000,
  });
  try {
    const store = new PostgresStore(pool);
    await store.migrate();
    await store.seed(raw, action === "reset");
    console.log(`ERP demo ${action} complete`);
  } finally {
    await pool.end();
  }
}
if (require.main === module)
  void run().catch((error: unknown) => {
    console.error(
      error instanceof Error &&
        /^(Reset requires|Data management|Use seed|Invalid demo)/.test(
          error.message,
        )
        ? error.message
        : "ERP demo data command failed; check configuration and connectivity",
    );
    process.exitCode = 1;
  });
