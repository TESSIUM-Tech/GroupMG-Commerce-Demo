# Documentación y pruebas de la API

Swagger se genera a partir de los controladores y DTO del backend. La interfaz está en http://localhost:3001/api/docs y el documento OpenAPI en http://localhost:3001/api/docs-json (si PORT cambia, usar ese puerto).

## Iniciar

Desde la raíz, con Docker y `.env` configurados:

```powershell
pnpm infra:up
pnpm db:migrate
pnpm --filter @groupmg/api build
pnpm --filter @groupmg/api start
```

Si necesitas productos demo, ejecuta `pnpm db:seed` en tu base local con `ALLOW_DEMO_SEED=true`.
`pnpm dev:api` solo observa y compila TypeScript; después de compilar cambios, reinicia el proceso del servidor para actualizar Swagger.

## Usar Swagger

Abre una operación, pulsa **Try it out**, completa sus parámetros y pulsa **Execute**. Verás el código HTTP, el cuerpo y las cabeceras.

| Método | Ruta                     | Función                                       |
| ------ | ------------------------ | --------------------------------------------- |
| GET    | /api/v1/health           | API activa, alias de liveness                 |
| GET    | /api/v1/health/liveness  | Proceso HTTP activo                           |
| GET    | /api/v1/health/readiness | Conexión PostgreSQL; 503 si falla             |
| POST   | /api/v1/health/validate  | Valida JSON y devuelve sus datos; no persiste |
| GET    | /api/v1/products         | Catálogo publicado; page, limit, q, category  |
| GET    | /api/v1/products/{id}    | Ficha por UUID obtenido del listado           |

El precio `priceMinor` usa unidades menores (19900 = 199,00 USD); `taxRateBps` usa puntos básicos (1500 = 15 %). `availableQuantity` e `inStock` describen la disponibilidad. La cabecera opcional `x-correlation-id` permite identificar una solicitud; la API devuelve ese identificador en cuerpo y cabecera.

Ejemplo para POST /health/validate:

```json
{ "echo": "Hola GroupMG", "repeat": 2 }
```

Prueba también `page=0` (400), un UUID válido inexistente (404) y una búsqueda sin resultados (200 con items vacío). Los módulos de autenticación, pedidos y pagos todavía no exponen operaciones y por eso no aparecen en Swagger.

## Verificación sin base de datos

```powershell
pnpm --filter @groupmg/api build
pnpm --filter @groupmg/api run test:swagger
pnpm --filter @groupmg/api run test:catalog:unit
```

La prueba de Swagger utiliza proveedores simulados, comprueba la publicación HTTP de UI/JSON, las seis rutas, validaciones de entrada y esquemas de respuesta; no realiza escrituras en PostgreSQL.
