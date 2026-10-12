# DEMO-09 — Pagos PayPhone (API Sale) y avisos verificados

Pasarela única: **PayPhone API Sale** (decidido en DEMO-01, `docs/demo-rules.md`).
El cliente aprueba el cobro en la app PayPhone de su celular. Ambiente de
**pruebas**: PayPhone aprueba todo y no hay cobros reales. Sin tarjetas guardadas
ni reembolsos reales.

## Flujo

1. `POST /api/v1/orders` crea el pedido `pending_payment` con stock reservado (DEMO-08).
2. `POST /api/v1/orders/{id}/payments` con `Authorization: Bearer <accessToken>`:
   cobra el total persistido, desglosado para PayPhone, al celular del pedido o al
   indicado en `{ "phone": "0991234567" }`. Amplía la reserva a 5 min 30 s para
   cubrir la ventana de pago de PayPhone.
3. El cliente aprueba o cancela en la app PayPhone.
4. PayPhone llama a la `responseUrl` que generó la API:
   `/api/v1/payments/payphone/callback/{firma}?id=…&clientTransactionID=…`.
5. La API verifica la firma, **consulta el estado real a PayPhone** y liquida en una
   sola transacción. Si el aviso no llega, la reconciliación lo resuelve.

## Criterio de verificación ("firma")

PayPhone no firma sus avisos. Se cumple el criterio en dos capas:

- **Firma propia:** la `responseUrl` lleva `HMAC-SHA256(PAYMENTS_CALLBACK_SECRET,
clientTransactionId)`. Un aviso sin firma válida recibe 401 y no se guarda nada.
- **Verificación con el proveedor:** con firma válida, la API consulta
  `GET /api/Sale/{id}` con su token y solo actúa si `transactionId`,
  `clientTransactionId`, importe y moneda coinciden con el pago guardado.

El aviso por sí solo nunca confirma un pago. Se guarda un recibo con el SHA-256
del aviso original (método, URL y cuerpo crudo).

## Endpoints

| Método   | Ruta                                             | Respuestas                                                                                  |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| POST     | `/api/v1/orders/{id}/payments`                   | 201 nuevo; 200 pago pendiente existente; 202 PayPhone no respondió; 409; 422; 503 sin pagos |
| GET/POST | `/api/v1/payments/payphone/callback/{signature}` | 200 liquidado o duplicado; 202 pendiente; 401 firma; 422 no coincide; 503 reintentar        |

## Liquidación (una transacción)

Recibo deduplicado por `transactionId:estado` → bloqueo `Inventory` → `StockReservation`
→ `Order` → `Payment` (mismo orden en todo el código, sin deadlocks) → resultado:

| Aviso verificado                               | Resultado                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Aprobado a tiempo                              | Reserva `consumed`, stock descontado, pedido `confirmed`, evento `order.confirmed.v1` en outbox |
| Aprobado tarde, hay stock                      | Pedido `confirmed` tomando stock libre, con evento                                              |
| Aprobado tarde, sin stock                      | Pedido y pago `review_required`; nunca se confirma stock inexistente                            |
| Segundo pago aprobado de un pedido ya pagado   | Pago `review_required` (cobro doble para devolver), sin segundo evento                          |
| Cancelado (statusCode 2) o rechazo simulado    | Pago `canceled`/`rejected`, pedido `canceled`, reserva liberada una vez                         |
| Cancelado después de aprobado (fuera de orden) | Ignorado: el pedido sigue confirmado                                                            |
| Duplicado                                      | Sin cambios                                                                                     |

Reglas puras y probadas: `payments/domain/approved-payment-policy.ts` y
`failed-payment-policy.ts`. Transiciones de pedido: `orders/domain/order-status.ts`.

## Reconciliación

Cada 60 s la API revisa pagos `pending` de más de 1 minuto (máx. 10 por ronda,
del más antiguo), dentro del límite de PayPhone de 30 consultas por minuto:
aviso perdido → se liquida; timeout al crear → se busca por `clientTransactionId`;
venta inexistente tras 10 min → pago `canceled`; datos que no coinciden →
`review_required`; PayPhone caído → se reintenta en la siguiente ronda.

## Configuración

| Variable                     | Uso                                                                     |
| ---------------------------- | ----------------------------------------------------------------------- |
| `PAYMENTS_MODE`              | `disabled` (por defecto), `simulated` (demo/tests) o `payphone`         |
| `PAYMENTS_SIMULATED_OUTCOME` | `approved`, `canceled` o `rejected` en modo simulado                    |
| `PAYMENTS_CALLBACK_SECRET`   | Clave HMAC, mínimo 32 caracteres                                        |
| `PAYPHONE_TOKEN`             | Token de la aplicación tipo API en ambiente Test de PayPhone Developers |
| `PAYPHONE_STORE_ID`          | Opcional: algunas aplicaciones solo exponen el token                    |
| `PAYPHONE_RESPONSE_URL`      | URL pública https del gateway, sin barra final                          |

Los secretos van solo en `.env` (no versionado); los errores de configuración
nombran variables, nunca valores. `simulated` está prohibido con `NODE_ENV=production`.
Compose pasa estas variables al contenedor `api`; sin ellas, pagos queda desactivado.

## Recibir eventos sandbox de PayPhone

1. En PayPhone Developers, la aplicación (tipo **API**) debe mostrar la etiqueta
   **Test**. En **Testers → Customers** invitar el celular de prueba: código +593 y
   número **sin el 0 inicial**. La persona debe tener cuenta en la app PayPhone y
   aceptar la invitación por correo.
2. Exponer el gateway con un túnel HTTPS, por ejemplo
   `cloudflared tunnel --url http://localhost:8080` o `ngrok http 8080`.
3. En `.env`: `PAYMENTS_MODE=payphone`, `PAYPHONE_TOKEN`, `PAYMENTS_CALLBACK_SECRET` y
   `PAYPHONE_RESPONSE_URL=https://<url-del-túnel>`.
4. `docker compose --profile app up --build -d`, crear un pedido, iniciar el pago con
   el celular del probador y aprobarlo en la app PayPhone.
5. Ver la transacción en PayPhone Developers → **Testers → Transactions** y el pedido
   con `GET /api/v1/orders/{id}`. Si el aviso no llega, la reconciliación lo resuelve
   en 1–2 minutos.

El aviso solo dispara la verificación. Si el túnel cambia de URL, actualizar
`PAYPHONE_RESPONSE_URL` y reiniciar la API; los pagos ya creados conservan su URL
anterior y se resuelven por reconciliación.

## Prueba a través del gateway (sin PayPhone real)

```powershell
docker compose -f compose.yaml -f infra/docker/compose.payments-smoke.yaml --profile app up --build -d
node apps/api/scripts/payments-gateway-smoke.cjs http://localhost:8080
```

El override marca el contenedor como entorno de pruebas para usar el modo simulado
(nunca en despliegues). El script recorre APISIX: pedido, pago, firma inválida (401),
aviso válido, duplicado, pedido confirmado con un evento outbox y límite de APISIX
(30 avisos por minuto e IP, 429). Usa una unidad de MG-DEMO-001 de la base demo.
Resultado local: 9/9 comprobaciones.

## Pruebas automáticas

`pnpm --filter @groupmg/api test:payments:unit` (sin base de datos) y
`test:payments` (PostgreSQL en `commerce_issue2_test`). Cubren firma inválida,
duplicados secuenciales y simultáneos, fuera de orden, rechazado, cancelado, pago
tardío con y sin stock, cobro doble, importes manipulados, timeouts, reconciliación
y el límite de 30 consultas por minuto. Ninguna prueba llama a PayPhone.

## Pendiente o fuera de alcance

- El publicador del outbox hacia RabbitMQ es DEMO-12. En local, RabbitMQ no arranca
  por permisos del volumen (`.erlang.cookie: eacces`); se revisará en DEMO-12.
- Reembolsos (API Reverse) y cancelación activa de ventas (API Cancel): fuera de alcance.
  Los pagos `review_required` se resuelven manualmente.
- El texto de `documentation/swagger.ts` aún dice que pagos no tiene endpoints;
  no se modificó por ser compartido.
