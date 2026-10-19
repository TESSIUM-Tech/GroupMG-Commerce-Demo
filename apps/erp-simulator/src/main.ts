import { Pool } from "pg";
import { readConfig } from "./config";
import { PostgresStore } from "./persistence/store";
import { createSimulatorServer } from "./http/server";

async function bootstrap() {
  const config = readConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  pool.on("error", () => console.error("ERP database connection interrupted"));
  const store = new PostgresStore(pool);
  try {
    await store.migrate();
    const server = createSimulatorServer(store, config);
    server.requestTimeout = 10000;
    server.listen(config.port, "0.0.0.0", () =>
      console.log(`ERP simulator listening on ${config.port}`),
    );
    const stop = () => {
      server.close(() => {
        void pool.end();
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch (error) {
    await pool.end();
    throw error;
  }
}
void bootstrap().catch(() => {
  console.error(
    "ERP startup failed. Check configuration and database connectivity.",
  );
  process.exitCode = 1;
});
