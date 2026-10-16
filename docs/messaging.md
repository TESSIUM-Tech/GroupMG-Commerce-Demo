# DEMO-12 — Outbox, RabbitMQ y exportación de ventas al ERP

Las ventas confirmadas (DEMO-09) llegan al ERP aunque RabbitMQ o el ERP estén
caídos temporalmente. Entrega **al menos una vez**; el worker deduplica por `eventId`.

```
PostgreSQL OutboxEvent ──relay API──► commerce.events ──order.confirmed.v1──► erp.sales.v1 ──► worker ERP ──► ErpPort
                            (confirms)                                         │  nack        (ack tras guardar)
                                                                               ▼
                                                         erp.sales.v1.retry (30 s) ──► erp.sales.v1
                                                         tras 5 intentos o evento inválido ──► erp.sales.dlq
```

## Topología (durable)

| Entidad              | Tipo           | Detalle                                                            |
| -------------------- | -------------- | ------------------------------------------------------------------ |
| `commerce.events`    | exchange topic | Recibe `order.confirmed.v1`                                        |
| `erp.sales.v1`       | cola classic   | Ventas para el ERP; rechazos van a la cola de reintento            |
| `erp.sales.v1.retry` | cola classic   | TTL 30 s y vuelve **solo** a `erp.sales.v1` (exchange por defecto) |
| `erp.sales.dlq`      | cola classic   | Ventas que agotaron 5 intentos, rechazadas por el ERP o inválidas  |

La declaran la API (`apps/api/src/messaging`) y el worker (`apps/worker-erp/src/messaging`)
con la misma definición; una prueba unitaria verifica que coincidan. Así la cola existe y
guarda ventas aunque el worker no esté en marcha.

## Publicador del outbox (API)

Cada 2 s toma un `OutboxEvent` `pending` a la vez (`FOR UPDATE SKIP LOCKED`), lo publica
persistente y `mandatory` con `messageId = eventId` y lo marca `published` **solo después**
del publisher confirm, en la misma transacción. Mensaje sin ruta, broker caído o timeout:
el evento sigue `pending` con `attempts + 1`; nunca se descarta. Una caída entre el confirm
y el marcado lo vuelve a publicar con el mismo `eventId`. Sin `RABBITMQ_URL` no arranca.

## Consumidor (worker ERP)

Un mensaje a la vez (`prefetch 1`). Valida `order.confirmed.v1` en runtime y exige
`messageId = eventId`. Registra el intento en `ErpSaleExport` (migración
`202610150001_erp_sale_export`, escrita solo por el worker, sin FK a `Order`) y llama a
`ErpPort.postSale(venta, idempotencyKey = eventId)`.

| Resultado                                  | Acción                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| Exportada                                  | `exported` + referencia ERP, después **ack**         |
| Mismo `eventId` ya exportado               | ack sin llamar al ERP (duplicado)                    |
| ERP caído/timeout (`ErpUnavailableError`)  | nack → reintento; en el 5.º intento → DLQ y `failed` |
| ERP rechaza (`ErpRejectedError`)           | DLQ y `failed`, sin reintentos                       |
| JSON/evento inválido, `messageId` distinto | DLQ, el ERP no se llama                              |
| Otro evento para un pedido ya exportado    | DLQ (nunca dos ventas del mismo pedido)              |
| Base de datos caída u otro error           | nack: nunca ack sin resultado persistido             |

La copia a la DLQ conserva cuerpo y propiedades y añade `x-dlq-reason`, `x-dlq-at`,
`x-dlq-delivery-count` y `x-original-queue`; el original se confirma (ack) solo después del
confirm de la DLQ. Una respuesta perdida del ERP se reconcilia en la siguiente entrega: la
misma clave idempotente devuelve la misma venta. El worker se reconecta cada 5 s si cae
RabbitMQ.

## Configuración

| Variable              | Dónde       | Uso                                                            |
| --------------------- | ----------- | -------------------------------------------------------------- |
| `RABBITMQ_URL`        | API, worker | `amqp://` local; vacío = mensajería inactiva                   |
| `RABBITMQ_URL_DOCKER` | Compose     | Misma URL con host `rabbitmq`                                  |
| `DATABASE_URL`        | worker      | Registros `ErpSaleExport`                                      |
| `ERP_ADAPTER`         | worker      | `none` (por defecto): no consume; DEMO-11 añadirá el simulador |

Las URLs se validan pero nunca se imprimen (llevan credenciales).

## Ejecución local

```powershell
docker compose up -d --wait postgres rabbitmq
pnpm db:migrate
pnpm build
pnpm --filter @groupmg/api start       # publica el outbox
pnpm --filter @groupmg/worker-erp start # sin ERP_ADAPTER queda en espera
```

Con Docker: `docker compose --profile app up --build -d`. RabbitMQ Management en
http://localhost:15672 (credenciales `RABBITMQ_DEFAULT_*`). RabbitMQ está en la red
`local-broker` para publicar 5672/15672 en 127.0.0.1, igual que PostgreSQL con `local-db`.

## Inspeccionar y reprocesar la DLQ

```powershell
node apps/worker-erp/scripts/erp-sales-dlq.cjs list
node apps/worker-erp/scripts/erp-sales-dlq.cjs reprocess <eventId>
node apps/worker-erp/scripts/erp-sales-dlq.cjs reprocess --all
```

1. `list` muestra `eventId`, `correlationId`, motivo, fecha, intentos, reprocesos y el
   estado en `ErpSaleExport`. Solo lee: los mensajes vuelven a la DLQ.
2. Corregir la causa (ERP disponible, dato maestro, adaptador).
3. `reprocess` devuelve la venta a `erp.sales.v1` con el mismo cuerpo, `eventId` y
   `correlationId` (la deduplicación sigue protegiendo), un presupuesto de intentos nuevo
   y la visita añadida en `x-dlq-history`. La copia en la DLQ se borra solo tras el
   confirm. `ErpSaleExport` conserva intentos y último error.
4. Verificar con `list` y en `ErpSaleExport` (`status = exported`). Para buscar en logs,
   usar `eventId` o `correlationId`.

## Pruebas

| Comando               | Requiere              | Cubre                                                              |
| --------------------- | --------------------- | ------------------------------------------------------------------ |
| `pnpm test`           | PostgreSQL            | API, incluida la configuración de mensajería                       |
| `pnpm test:worker`    | PostgreSQL            | Validación del evento, dedup, ERP caído/rechazo, respuesta perdida |
| `pnpm test:messaging` | PostgreSQL + RabbitMQ | Topología, relay, consumidor, DLQ y extremo a extremo              |

Variables: `ALLOW_DB_TESTS=true`, `ALLOW_RABBITMQ_TESTS=true`, base `commerce_issue2_test`.
Las pruebas usan colas propias (`test.*`) y las borran. La CI ejecuta las tres.

Escenarios del issue: broker caído (relay sin publicar, evento `pending`), reinicio entre
publicación y marcado (republica el mismo `eventId`, una sola venta), fallo del ERP (retry y
DLQ), reentrega sin venta duplicada (worker que muere a mitad y duplicados simultáneos).
Reinicio real del contenedor: `ALLOW_BROKER_RESTART_TESTS=true pnpm test:messaging`
(ejecuta `docker compose stop/up rabbitmq`; no se usa en CI).

## Para DEMO-11 (simulador ERP)

- Implementar `ErpPort` (`apps/worker-erp/src/ports/erp.port.ts`), registrarlo en
  `ports/erp-adapters.ts` y añadir su nombre a `ErpAdapterName` en `config/worker.config.ts`.
- Lanzar `ErpUnavailableError` (reintentar) o `ErpRejectedError` (DLQ) de `ports/erp-errors.ts`.
- `postSale` debe ser idempotente por `idempotencyKey` (= `eventId`).

## Problemas conocidos en local

- `.erlang.cookie: eacces` al arrancar RabbitMQ: el archivo del volumen quedó a nombre de
  root. Se corrige sin borrar datos:
  `docker run --rm --user root --entrypoint chown -v groupmg-commerce_rabbitmq-data:/var/lib/rabbitmq rabbitmq:4.1-management rabbitmq:rabbitmq /var/lib/rabbitmq/.erlang.cookie`.
- `Socket closed abruptly during opening handshake`: RabbitMQ aún arranca; esperar a `healthy`.

## Fuera de alcance

Adaptador ERP real o simulado (DEMO-11), sincronización de inventario (DEMO-13), alta
disponibilidad de RabbitMQ y métricas de colas.
