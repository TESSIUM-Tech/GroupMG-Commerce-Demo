import "reflect-metadata";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(__dirname, "../../../.env"), quiet: true });
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { validateEnv } from "./config/env.config";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { setupSwagger } from "./documentation/swagger";

async function bootstrap() {
  const appConfig = validateEnv(process.env);

  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix(appConfig.globalPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  setupSwagger(app);

  app.enableShutdownHooks();

  await app.listen(appConfig.port, "0.0.0.0");
}

void bootstrap().catch(() => {
  console.error(
    "API startup failed. Check configuration and database connectivity; credentials are not logged.",
  );
  process.exitCode = 1;
});
