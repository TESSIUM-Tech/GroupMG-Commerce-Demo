import "reflect-metadata";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(__dirname, "../../../.env"), quiet: true });
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log(
    "Worker ERP iniciado: exportación de ventas (DEMO-12) y sincronización de inventario (DEMO-13)",
    "Bootstrap",
  );
  // Mantiene vivo el proceso aunque la exportación esté inactiva (sin ERP).
  const heartbeat = setInterval(() => {}, 60_000);
  const stop = () => clearInterval(heartbeat);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
