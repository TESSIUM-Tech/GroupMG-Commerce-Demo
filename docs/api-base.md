# DEMO-03 — Base consistente para endpoints de la API

Este documento detalla la infraestructura base para los endpoints de la API, cubriendo validación de configuración, trazabilidad con `correlationId`, validación de DTOs en runtime, respuesta uniforme de errores sin stacks internos y comprobación de liveness/readiness de PostgreSQL.

## Configuración y arranque seguro

- Se valida el entorno antes de iniciar NestJS en `apps/api/src/config/env.config.ts`.
- Variables obligatorias: `DATABASE_URL` (debe ser una URL válida con protocolo `postgresql:` o `postgres:`).
- Variables opcionales: `PORT` (entero entre 1 y 65535, por defecto 3001), `NODE_ENV` (por defecto development).
- **Protección de secretos:** Si la configuración falla o la conexión a la base de datos es rechazada, los mensajes de error y registros omiten contraseñas y datos sensibles. `maskConnectionString()` enmascara credenciales en formato `user:******@host:port/db`.

## Trazabilidad y correlationId

- Cada solicitud HTTP procesada por la API incluye un identificador de correlación:
  - Si el cliente envía la cabecera `x-correlation-id` (o `x-request-id`), se sanitiza y reutiliza.
  - Si no se envía cabecera, se genera automáticamente un UUID v4.
- El `correlationId` se propaga en:
  1. La cabecera HTTP de respuesta `x-correlation-id`.
  2. El cuerpo de respuesta JSON (`correlationId`).
  3. Los registros estructurados de servidor: `[API] [<correlationId>] <METHOD> <PATH> <STATUS> (<DURATION>ms)`.

## Endpoints iniciales

Los endpoints se exponen bajo el prefijo global `/api/v1` (accesibles localmente en `http://localhost:3001/api/v1/...` o a través del API Gateway APISIX en `http://localhost:8080/api/v1/...`).

### 1. Liveness (Salud del proceso)

- **Ruta:** `GET /api/v1/health` o `GET /api/v1/health/liveness`
- **Propósito:** Certificar que el proceso Node.js/NestJS responde a solicitudes HTTP. No depende de la disponibilidad de la base de datos.
- **Respuesta exitosa (200 OK):**
  ```json
  {
    "service": "api",
    "status": "ok",
    "scope": "liveness",
    "correlationId": "30bbaae9-1bd6-4c79-bbd0-f03dba8c41d6"
  }
  ```

### 2. Readiness (Disponibilidad de dependencias)

- **Ruta:** `GET /api/v1/health/readiness`
- **Propósito:** Verificar que PostgreSQL está accesible y listo para atender consultas (`SELECT 1`).
- **Respuesta exitosa (200 OK):**
  ```json
  {
    "service": "api",
    "status": "ok",
    "scope": "readiness",
    "checks": {
      "database": "ok"
    },
    "correlationId": "03dade55-6014-40be-8026-fa5554621cdc"
  }
  ```
- **Respuesta ante fallo de base de datos (503 Service Unavailable):**
  ```json
  {
    "statusCode": 503,
    "error": "Service Unavailable",
    "message": "Database readiness check failed",
    "service": "api",
    "scope": "readiness",
    "checks": {
      "database": "down"
    },
    "correlationId": "a3214f1b-2c5c-4a7d-b588-31638e4885c8",
    "timestamp": "2026-10-02T00:49:33.456Z",
    "path": "/api/v1/health/readiness"
  }
  ```

### 3. Validación de DTOs en runtime y rechazo de campos no permitidos

- **Ruta:** `POST /api/v1/health/validate`
- **Propósito:** Endpoint inicial para comprobar la validación de DTOs en tiempo de ejecución, el descarte/rechazo estricto de campos no permitidos (`forbidNonWhitelisted: true`) y el formato uniforme de errores HTTP.
- **Payload esperado (`HealthValidateDto`):**
  ```json
  {
    "echo": "mensaje de prueba",
    "repeat": 2
  }
  ```
- **Respuesta exitosa (201 Created):**
  ```json
  {
    "status": "ok",
    "validated": true,
    "data": {
      "echo": "mensaje de prueba",
      "repeat": 2
    },
    "correlationId": "test-live-trace-123"
  }
  ```
- **Respuesta ante campo no permitido (400 Bad Request):**
  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": ["property forbiddenField should not exist"],
    "correlationId": "c76eb996-6257-4681-97a4-d837d6fae9cf",
    "timestamp": "2026-10-02T00:53:22.866Z",
    "path": "/api/v1/health/validate"
  }
  ```
- **Respuesta ante tipo inválido (400 Bad Request):**
  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": [
      "echo must be shorter than or equal to 100 characters",
      "echo must be a string"
    ],
    "correlationId": "a40e376c-dcd9-4c6e-ae57-462e79009e32",
    "timestamp": "2026-10-02T00:53:32.959Z",
    "path": "/api/v1/health/validate"
  }
  ```

## Estructura uniforme de errores

El filtro global `HttpExceptionFilter` intercepta todas las excepciones y responde bajo un esquema estándar:

```typescript
interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  correlationId: string;
  timestamp: string;
  path: string;
}
```

**Reglas de seguridad en errores:**

- Nunca se expone el stack trace interno (`stack`) en las respuestas HTTP a los clientes.
- Los errores no controlados (500) devuelven un mensaje genérico `"An internal server error occurred"`.
- Los detalles técnicos se registran en los logs del servidor asociados a `[correlationId]`, omitiendo credenciales.

## Conexión del repositorio PostgreSQL

- `PrismaService` en `apps/api/src/database/prisma.service.ts` provee la conexión gestionada y el método `ping()`.
- Se define el puerto del repositorio `CatalogRepository` (`apps/api/src/modules/catalog/domain/catalog.repository.port.ts`) y su implementación `PrismaCatalogRepository` (`apps/api/src/modules/catalog/infrastructure/prisma-catalog.repository.ts`), desacoplando la capa de datos y conectando el módulo de catálogo a PostgreSQL.

## Pruebas de integración

Para ejecutar las pruebas de integración base de la API:

```powershell
docker compose exec -T postgres createdb -U commerce commerce_issue2_test # si no existe
$env:DATABASE_URL = 'postgresql://commerce:local-change-me@127.0.0.1:5432/commerce_issue2_test?schema=public'
$env:ALLOW_DEMO_SEED = 'true'
$env:ALLOW_DB_TESTS = 'true'
pnpm run db:migrate
pnpm run test:api
```

Para ejecutar la suite completa (persistencia PostgreSQL + endpoints API):

```powershell
pnpm run test
```
