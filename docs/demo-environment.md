# DEMO-14 — Entorno de Demo, Diagnóstico y Operación

Este documento define la operación reproducible, diagnóstico y seguimiento del entorno completo de demostración de **GroupMG Commerce**, asegurando que cualquier integrante del equipo pueda levantar, verificar y presentar la demo sin configuraciones ocultas.

---

## 1. Servicios del Entorno y Readiness Real

El entorno se orquesta mediante Docker Compose v2 (`compose.yaml`) bajo el perfil `app`:

```
                                  ┌────────────────────────┐
                                  │      Cliente Web       │
                                  └───────────┬────────────┘
                                              │  http://localhost:8080
                                              ▼
                                  ┌────────────────────────┐
                                  │   APISIX API Gateway   │
                                  └─────┬────────────┬─────┘
                                        │            │
                     /health, /*        │            │  /api/v1/*
                                        ▼            ▼
                                  ┌───────────┐┌───────────┐
                                  │ Next.js   ││ NestJS    │
                                  │ Web (3000)││ API (3001)│
                                  └─────┬─────┘└─────┬─────┘
                                        │            │
                                        │            │ Conexión PostgreSQL (5432)
                                        │            │ Outbox -> RabbitMQ (5672)
                                        ▼            ▼
                   ┌────────────────────────────────────────────────────────┐
                   │                     Infraestructura                    │
                   │  PostgreSQL (5432) · RabbitMQ (5672) · Redis (6379)     │
                   └──────────────────────────┬─────────────────────────────┘
                                              │
                         order.confirmed.v1   │ erp.sales.v1
                                              ▼
                                  ┌───────────────────────┐
                                  │  Worker ERP (NestJS)  │
                                  │  - Consumo ventas     │
                                  │  - Sincronización inv │
                                  └───────────┬───────────┘
                                              │  HTTP (3003)
                                              ▼
                                  ┌───────────────────────┐
                                  │  Simulador ERP (3003) │
                                  │  - erp-postgres (5433)│
                                  └───────────────────────┘
```

### Readiness Real y Secuencia de Arranque

- **PostgreSQL (`postgres`):** healthcheck nativo con `pg_isready`.
- **RabbitMQ (`rabbitmq`):** healthcheck con `rabbitmq-diagnostics -q ping`.
- **API NestJS (`api`):** healthcheck en `GET /api/v1/health/readiness`. Comprueba conectividad real ejecutando un ping a la base de datos PostgreSQL. Solo pasa a `healthy` cuando la base responde.
- **Web Storefront (`web`):** healthcheck en `GET /health`.
- **Simulador ERP (`erp-simulator`):** healthcheck en `GET /health` tras migrar su esquema en `erp-postgres`.
- **Gateway APISIX (`gateway`):** configurado con dependencia `condition: service_healthy` hacia `web` y `api`. APISIX no abre tráfico hasta que el backend y frontend han certificado su disponibilidad.

---

## 2. Diagnóstico del Entorno (`demo:doctor`)

Para diagnosticar el estado del entorno antes de una presentación:

```bash
pnpm demo:doctor
# o alternativamente:
pnpm demo:status
```

Este script automatizado (`scripts/demo-diagnostics.cjs`) verifica:

1. **Requisitos de runtime:** Node.js >= 24 y dependencias del monorepo.
2. **Configuración `.env`:** existencia de variables requeridas y protección estricta de credenciales (las contraseñas se enmascaran automáticamente como `user:******@host`).
3. **Perímetro de red:** comprueba que los puertos de infraestructura (`5432`, `6379`, `5672`, `15672`, `8080`) estén enlazados a `127.0.0.1` y nunca a interfaces abiertas (`0.0.0.0`).
4. **Readiness de servicios:** sondea los endpoints de salud de Gateway, Web, API (liveness + readiness), Simulador ERP y consola de RabbitMQ.

---

## 3. Trazabilidad Completa de una Compra en Logs

Cada compra se rastrea de extremo a extremo mediante `correlationId` (HTTP), `orderId` (negocio) y `eventId` (mensajería).

Para seguir el flujo en vivo durante la demo:

```bash
docker compose logs -f api worker-erp
```

### Secuencia de Logs Esperada:

1. **Creación del pedido:**
   ```text
   api-1 | [API] [corr-demo-01] POST /api/v1/orders 201 (24ms)
   ```
2. **Inicio del pago:**
   ```text
   api-1 | [API] [corr-demo-01] POST /api/v1/orders/550e8400-e29b-41d4-a716-446655440000/payments 201 (18ms)
   ```
3. **Confirmación y Outbox atómico:**
   ```text
   api-1 | [API] Order confirmed: orderId=550e8400-e29b-41d4-a716-446655440000 eventId=a1b2c3d4-e5f6-7890-abcd-ef1234567890 correlationId=corr-demo-01
   ```
4. **Relé del Outbox a RabbitMQ:**
   ```text
   api-1 | [API] Outbox relayed: eventId=a1b2c3d4-e5f6-7890-abcd-ef1234567890 type=order.confirmed.v1 correlationId=corr-demo-01
   ```
5. **Consumo y exportación en el Worker ERP:**
   ```text
   worker-erp-1 | [worker] Sale a1b2c3d4-e5f6-7890-abcd-ef1234567890 exported: ERP reference 22222222-2222-4222-8222-222222222222
   ```
6. **Sincronización periódica de inventario:**
   ```text
   worker-erp-1 | [InventorySyncWorker] Inventory sync completed: 1 page(s), 12 item(s) processed (12 updated, 0 stale rejected, 0 not found)
   ```

---

## 4. Ciclo de Vida del Entorno

| Acción                       | Comando                                | Descripción                                                                    |
| :--------------------------- | :------------------------------------- | :----------------------------------------------------------------------------- |
| **Iniciar entorno completo** | `pnpm demo:up`                         | Compila y levanta todos los contenedores con Compose en segundo plano.         |
| **Cargar datos de prueba**   | `pnpm demo:seed`                       | Carga el catálogo ficticio en PostgreSQL Commerce y en el Simulador ERP.       |
| **Diagnosticar salud**       | `pnpm demo:doctor`                     | Reporta el estado de salud, readiness y variables de entorno.                  |
| **Detener entorno**          | `pnpm demo:down`                       | Apaga los contenedores conservando los datos de los volúmenes.                 |
| **Reinicio destructivo**     | `pnpm demo:reset --confirm-demo-reset` | Restablece las órdenes, pagos, outbox y ventas demo a cero de forma protegida. |

> [!WARNING]
> `pnpm demo:reset` requiere obligatoriamente la bandera `--confirm-demo-reset`. Esta operación solo limpia tablas transaccionales de prueba y no altera el esquema de la base de datos.

---

## 5. Presentación Pública con TLS y PayPhone Sandbox

Si la demo se presenta a través de una URL pública (por ejemplo, para recibir avisos reales de la app PayPhone Personal en un teléfono móvil físico):

1. **Crear un túnel seguro con TLS hacia el Gateway local:**
   - Usando Cloudflare Tunnel:
     ```bash
     cloudflared tunnel --url http://localhost:8080
     ```
   - O usando ngrok:
     ```bash
     ngrok http 8080
     ```
2. **Configurar la URL pública en `.env`:**
   ```env
   PAYPHONE_RESPONSE_URL=https://tu-subdominio.trycloudflare.com/api/v1/payments/payphone/callback
   ```
3. **Reiniciar la API para cargar la nueva URL:**
   ```bash
   docker compose up -d api
   ```
4. **Verificar la ruta del webhook sandbox:**
   ```bash
   node apps/api/scripts/payments-gateway-smoke.cjs https://tu-subdominio.trycloudflare.com
   ```
   El script comprobará la accesibilidad a través del gateway público, la generación correcta de firmas HMAC y la respuesta del callback sin revelar secretos en los registros.
