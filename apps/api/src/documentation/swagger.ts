import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("GroupMG Commerce API")
    .setDescription(
      "API de demostración. Salud del servicio y catálogo publicado. Pedidos, autenticación y pagos aún no tienen endpoints implementados.",
    )
    .setVersion("1.0")
    .addTag("Salud", "Disponibilidad del servicio y validación de entradas")
    .addTag("Catálogo", "Productos publicados, búsqueda y paginación")
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: "api/docs-json",
      swaggerOptions: { docExpansion: "list", validatorUrl: null },
    },
  );
}
