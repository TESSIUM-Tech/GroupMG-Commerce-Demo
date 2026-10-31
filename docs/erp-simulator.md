# ERP ficticio y capa anticorrupción

El servicio `apps/erp-simulator` expone un ERP HTTP independiente. El worker accede mediante `ErpPort`, enlazado al token `ERP_PORT` de Nest. Los casos de uso deben inyectar ese token y utilizar exclusivamente `InventoryItem` y `ErpSale`. Los DTO externos, validaciones de respuestas y conversiones quedan en `apps/worker-erp/src/adapters/simulated-erp/`.

El servidor usa Node HTTP y `pg`: un transporte pequeño, validaciones explícitas y transacciones PostgreSQL. No se añadieron consumidores RabbitMQ, publicación de outbox ni sincronización programada; el worker continúa siendo un scaffold con el adaptador disponible para esas tareas posteriores. No cambia el flujo de compra ni el inventario de commerce.

## Contrato HTTP v1

### Swagger interactivo

El ERP publica su propia documentación en **http://localhost:3003/docs** y el contrato OpenAPI 3.0 en **http://localhost:3003/openapi.json**. Para acceder desde el equipo, utiliza el override `infra/docker/compose.erp-local.yaml` explicado más abajo; el Compose base no publica el puerto ERP.

Abre una operación, pulsa **Try it out**, completa sus parámetros y pulsa **Execute**. Para una venta, conserva la misma `Idempotency-Key` al repetir: la primera llamada devuelve 201 y las siguientes 200 con el mismo identificador. Cambiar el importe manteniendo esa clave debe devolver 409. Ejecutar POST registra una venta real dentro del simulador demo.

Los tres endpoints incluyen parámetros, esquemas, ejemplos y errores. Swagger y sus archivos estáticos se sirven localmente, sin CDN ni validadores externos, y siguen accesibles durante los fallos demo o si PostgreSQL deja de responder después del arranque. El proceso aún necesita PostgreSQL disponible para completar su arranque. La documentación general de commerce continúa separada en http://localhost:3001/api/docs.

### GET /v1/inventory?limit=20&cursor=…

`limit` es un entero entre 1 y 100 (por defecto 20). Cursor opaco devuelto por la página anterior. Parámetros inválidos, repetidos o adicionales: 400. La primera página no envía cursor. Orden ascendente por SKU con comparación PostgreSQL `C` y paginación por clave, sin offsets.

```json
{
  "records": [
    {
      "product_code": "MG-DEMO-001",
      "quantity_available": 20,
      "modified_at": "2026-01-01T00:00:00.000Z"
    }
  ],
  "next_cursor": "TUctREVNTy0wMDE"
}
```

El ejemplo ilustra el formato; cantidades y páginas reales se obtienen de `docs/demo-products.json`. `next_cursor: null` significa fin. Con inventario sin modificaciones, recorrer todas las páginas no omite ni duplica registros. No se promete una fotografía global entre peticiones concurrentes con cambios de datos.

### POST /v1/sales

Cabeceras: `Content-Type: application/json`, `Idempotency-Key` obligatoria, entre 16 y 128 caracteres alfanuméricos, guion o guion bajo.

```json
{
  "reference": "11111111-1111-4111-8111-111111111111",
  "currency_code": "USD",
  "gross_amount_minor": 22885
}
```

`reference`: identificador del pedido, entre 1 y 128 caracteres alfanuméricos, punto, guion o guion bajo. Moneda: tres letras mayúsculas. Importe: entero positivo máximo 2147483647, en unidades menores. Se rechazan campos adicionales. Cuerpo máximo 16 KiB.

```json
{
  "sale_id": "22222222-2222-4222-8222-222222222222",
  "reference": "11111111-1111-4111-8111-111111111111"
}
```

| Respuesta | Significado                                                            |
| --------- | ---------------------------------------------------------------------- |
| 201       | Venta creada                                                           |
| 200       | Repetición: misma clave o referencia y mismo contenido; mismo sale_id  |
| 400       | Entrada o clave inválida                                               |
| 409       | Misma clave o referencia con contenido diferente; sin nueva venta      |
| 413 / 415 | Cuerpo demasiado grande / tipo de contenido incorrecto                 |
| 503       | Base no disponible o escenario demo unavailable                        |
| 504       | Escenario timeout-before, si el cliente espera hasta recibir respuesta |

Una referencia repetida con clave nueva y mismo contenido devuelve la venta existente y registra esa nueva clave como alias. Tanto referencia como claves son únicas. Su huella SHA-256 usa los campos normalizados; los bloqueos transaccionales serializan ambas identidades. Venta y claves se guardan atómicamente, incluso entre varias instancias. Las ventas no descuentan inventario: `ErpSale` todavía no contiene líneas y este simulador solo registra la venta.

### GET /health

200 con `{"status":"ok"}` si PostgreSQL responde. 503 si no está disponible. Los escenarios de fallo no afectan el healthcheck. Todas las respuestas JSON llevan `Cache-Control: no-store`. El servicio no tiene autenticación y se mantiene en redes internas; no publicarlo en Internet.

## Persistencia y datos reproducibles

El servicio `erp-postgres` tiene una base **erp_demo** y volumen **erp-postgres-data**, separados de commerce. El simulador rechaza URLs con otro nombre de base. Al arrancar aplica la versión inicial de su esquema `erp_sim`, protegida contra arranques concurrentes. Inventario, ventas y claves viven en tablas independientes. Reiniciar servicios conserva los datos; no hay seed ni reset automático.

`seed` carga SKUs y stock de `docs/demo-products.json` con fecha fija y no modifica filas existentes ni elimina ventas. `reset` vacía exclusivamente las tres tablas de datos ERP y restaura el fixture, en una transacción. El reset excluye registros de venta concurrentes mediante un bloqueo compartido/exclusivo; reinicia también la deduplicación. No elimina la base commerce ni sus pedidos.

## Ejecución con Compose

Configura en `.env` las variables nuevas de `.env.example`. Compose usa una contraseña local demo por defecto para mantener compatibles los comandos existentes; configura `ERP_POSTGRES_PASSWORD` para tu entorno. Usa caracteres seguros para URL o codifícalos correctamente en las URLs de conexión.

```powershell
# Solo ERP y su base; no inicia commerce ni pagos
docker compose --profile erp-demo up --build -d erp-simulator

# Carga inicial reproducible; no borra ventas
docker compose exec erp-simulator node dist/demo/manage.js seed

# Reinicio conservando ventas y deduplicación
docker compose restart erp-simulator erp-postgres

# DESTRUCTIVO SOLO PARA EL ERP DEMO: restaurar datos iniciales
docker compose exec erp-simulator node dist/demo/manage.js reset --confirm-erp-demo-reset
```

El perfil `app` también incluye los servicios ERP y configura el worker con `ERP_BASE_URL=http://erp-simulator:3003`. El puerto no se publica por defecto. Para pruebas locales en localhost y PostgreSQL 5433:

```powershell
docker compose -f compose.yaml -f infra/docker/compose.erp-local.yaml --profile erp-demo up --build -d erp-simulator
```

En ejecución Node local, compila primero ambos workspaces y configura `ERP_DATABASE_URL` apuntando al puerto 5433. Usa `pnpm erp:seed` y `pnpm erp:reset` (este último ya transmite el argumento explícito de reset). Arranca con `pnpm --filter @groupmg/erp-simulator start`. El worker lee variables del proceso/Compose; para ejecutarlo localmente, exporta `ERP_BASE_URL`, `ERP_TIMEOUT_MS` y `ERP_PAGE_SIZE` en tu terminal.

## Fallos demo

| Variable            | Valor por defecto y función                                          |
| ------------------- | -------------------------------------------------------------------- |
| ERP_ENV             | Compose usa demo; fuera de demo no se permiten fallos, seed ni reset |
| ERP_DEMO_SCENARIO   | normal, unavailable, timeout-before o timeout-after                  |
| ERP_DEMO_LATENCY_MS | 0; demora fija, máximo 60000 ms                                      |
| ERP_DEMO_TIMEOUT_MS | 10000; demora de escenarios timeout, máximo 60000 ms                 |
| ERP_TIMEOUT_MS      | 3000; timeout del adaptador, entre 1 y 60000 ms                      |
| ERP_PAGE_SIZE       | 20; tamaño de página del adaptador, entre 1 y 100                    |
| ERP_ADAPTER         | simulated; selección en el módulo del worker                         |

`unavailable` responde 503 sin escribir. `timeout-before` espera y termina con 504 sin escribir. `timeout-after` guarda la venta y retrasa su respuesta; repetir la misma clave después de recuperar el servicio devuelve el mismo identificador. Ajusta la demora por encima del timeout del adaptador. Los escenarios son deterministas y afectan todas las operaciones de inventario/ventas mientras están activos, sin controles HTTP administrativos.

Tras cambiar `.env`, aplica `docker compose --profile erp-demo up -d erp-simulator` para recrear con nueva configuración. Un simple restart no recarga variables. Para desactivar fallos, vuelve a normal y latencia 0. La frontera es `ERP_ENV`, independiente de `NODE_ENV`, porque el Dockerfile usa NODE_ENV=production incluso para esta demo.

El adaptador no hace reintentos ocultos. Traduce conexión, timeout, 408, 429 y 5xx a `ErpUnavailableError`; 409 a `ErpConflictError`; otros errores HTTP a `ErpRequestError`; respuestas incompatibles a `ErpContractError`. Un consumidor debe conservar la clave original al reintentar; un timeout no significa que la venta haya fallado.

## Pruebas

```powershell
pnpm --filter @groupmg/erp-simulator build
pnpm --filter @groupmg/worker-erp build
pnpm test:erp
pnpm --filter @groupmg/worker-erp test
```

Las pruebas HTTP usan almacenamiento simulado y el adaptador real. La prueba PostgreSQL se omite por defecto; requiere una base **erp_demo desechable**. El siguiente comando borra sus datos ERP:

```powershell
$env:ERP_ENV='demo'
$env:ERP_DATABASE_URL='postgresql://erp_demo:CLAVE@127.0.0.1:5433/erp_demo'
$env:ALLOW_ERP_DB_TESTS='true'
pnpm --filter @groupmg/erp-simulator run test:db
```

Verifica 12 registros concurrentes de una referencia, conflicto de clave, paginación, seed no destructivo, reconexión y reinicio del servidor, timeout después de guardar y reset. No apuntar esta prueba a una demo que quieras conservar.

## Sustituir el proveedor

Implementa `ErpPort` en otro adaptador, con DTO y mapeadores propios, y añade su selección en la fábrica de `AppModule` del worker. Los casos de uso continúan inyectando `ERP_PORT`; no importan clases ni errores HTTP del simulador. El registro de ventas y el inventario de commerce no dependen del formato externo.
