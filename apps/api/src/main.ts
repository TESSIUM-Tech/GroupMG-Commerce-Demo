import "reflect-metadata";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(__dirname, "../../../.env"), quiet: true });
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}
void bootstrap().catch(() => {
  console.error(
    "API startup failed. Check configuration and database connectivity; credentials are not logged.",
  );
  process.exitCode = 1;
});
