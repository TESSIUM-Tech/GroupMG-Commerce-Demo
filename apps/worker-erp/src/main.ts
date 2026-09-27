import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log(
    "ERP scaffold: consumidores y tareas programadas pendientes",
    "Bootstrap",
  );
  // Mantiene vivo el proceso del scaffold; no representa un consumidor activo.
  const heartbeat = setInterval(() => {}, 60_000);
  const stop = () => clearInterval(heartbeat);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
