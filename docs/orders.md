# DEMO-08 — Pedidos pendientes con reserva de stock e idempotencia

Creación y consulta de pedidos de invitados. Los importes, el IVA y el envío se
calculan en el servidor desde PostgreSQL. No hay pagos en este issue: el pedido
queda en `pending_payment` con stock reservado durante 5 minutos (DEMO-09).

No requiere migraciones: utiliza el esquema de DEMO-02 (`Order`, `OrderItem`,
`GuestCustomer`, `StockReservation`, `Inventory`, `ShippingRate`).

## Endpoints

| Método | Ruta                | Función                                    |
| ------ | ------------------- | ------------------------------------------ |
| POST   | /api/v1/orders      | Crea un pedido pendiente y reserva stock   |
| GET    | /api/v1/orders/{id} | Consulta el pedido con su credencial opaca |

### POST /api/v1/orders

Cabecera obligatoria `Idempotency-Key`: 16 a 128 caracteres `A-Z a-z 0-9 _ -`
(un UUID generado por el cliente sirve). Cuerpo:

```json
{
  "items": [{ "sku": "MG-DEMO-001", "quantity": 1 }],
  "customer": {
    "firstName": "Ana",
    "lastName": "Demo",
    "email": "ana@example.invalid",
    "phone": "0991234567"
  },
  "fulfillment": { "type": "pickup" },
  "billing": {
    "identificationType": "cedula",
    "identification": "1710034065",
    "name": "Ana Demo",
    "email": "ana@example.invalid",
    "address": "Quito"
  }
}
```

Para repartidor: `"fulfillment": { "type": "courier", "shippingAddress": { "province",
"city", "zone", "address", "reference" } }`. El checkout web llama `delivery` a esta
opción; DEMO-10 debe enviarla como `courier`.

| Respuesta | Caso                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| 201       | Pedido creado. Devuelve `order`, `accessToken` y `correlationId`                                        |
| 200       | Repetición con la misma clave y el mismo cuerpo: mismo pedido y token nuevo                             |
| 400       | Cuerpo inválido, campos no permitidos (importes, estado) o cabecera ausente                             |
| 409       | Stock insuficiente; `skus` indica los productos afectados                                               |
| 422       | Producto inexistente/no publicado (`skus`), zona sin tarifa vigente o clave reutilizada con otro cuerpo |

El cuerpo no admite `totalMinor`, precios ni estado: la lista blanca global los
rechaza con 400. Las respuestas llevan `Cache-Control: no-store`.

### GET /api/v1/orders/{id}

Requiere `Authorization: Bearer <accessToken>`. Sin token o con formato inválido: 401.
Token incorrecto, vencido o pedido inexistente: el mismo 404, para no revelar qué
IDs existen. La respuesta no incluye datos personales del cliente.

## Reglas implementadas

- **Precios:** desde `Product` publicado. IVA por línea con redondeo mitad hacia
  arriba, igual que el CHECK `item_money`. Envío: tarifa vigente de mayor versión
  para la zona exacta; IVA de envío con la misma regla. Importes acotados a INTEGER.
- **Snapshot:** cada `OrderItem` guarda SKU, referencia, nombre, precio e IVA.
  El pedido guarda contacto, facturación, dirección, zona y versión de tarifa.
- **Reserva y concurrencia:** en una transacción se bloquean las filas de
  `Inventory` en orden de `productId` y se incrementa `reserved` solo si
  `onHand - reserved >= cantidad`. Dos compras del último artículo: una gana y la
  otra recibe 409. El CHECK `reserved <= onHand` es la segunda barrera.
- **Idempotencia:** `requestHash` = SHA-256 del cuerpo normalizado (ítems por SKU,
  claves ordenadas, correos en minúsculas). Las solicitudes con la misma clave se
  serializan con `pg_advisory_xact_lock`, así una repetición nunca compite por stock.
  Misma clave y otro cuerpo: 422 sin efectos.
- **Credencial opaca:** 32 bytes aleatorios (base64url) entregados una sola vez; en
  base solo se guarda su SHA-256. Vence a las 24 horas. Una repetición idempotente
  emite un token nuevo y el anterior deja de funcionar, porque el original no puede
  reconstruirse desde su hash.
- **Expiración:** la reserva vence a los 5 minutos. Se libera una sola vez:
  reserva `active → released`, `reserved` disminuye y el pedido `pending_payment →
expired`. Ocurre al crear un pedido de esos productos y en un barrido interno cada
  60 s (`setInterval` sin dependencias; seguro con varios procesos por
  `FOR UPDATE SKIP LOCKED`).

## Estados

| Desde                              | Hacia permitido                                       |
| ---------------------------------- | ----------------------------------------------------- |
| `pending_payment`                  | `confirmed`, `canceled`, `expired`, `review_required` |
| `review_required`                  | `confirmed`, `canceled`                               |
| `confirmed`, `canceled`, `expired` | ninguno (finales)                                     |

`domain/order-status.ts` exporta `canTransition` y `assertTransition` para DEMO-09.

## Notas para DEMO-09

- Confirmar o cancelar debe bloquear primero las filas de `Inventory` en orden de
  `productId` (como `lockInventory`), para no producir deadlocks con este módulo.
- Al confirmar, consumir la reserva (`active → consumed`) y restar `onHand` y
  `reserved` en la misma transacción que el outbox. Si la reserva ya fue liberada,
  revalidar stock; si no alcanza, `review_required` (docs/demo-rules.md).
- El módulo exporta `ORDERS_REPOSITORY`.

## Pruebas

Tras compilar (`pnpm --filter @groupmg/api build`):

- `pnpm --filter @groupmg/api test:orders:unit`: sin base de datos. Transiciones,
  redondeo de IVA, totales, hash de solicitud, token y validaciones.
- `pnpm --filter @groupmg/api test:orders`: HTTP con PostgreSQL real en
  `commerce_issue2_test` y `ALLOW_DB_TESTS=true`, igual que el resto de la suite.

Cubre: total manipulado, cinco compras simultáneas del último artículo, misma clave
con igual y distinto cuerpo, claves concurrentes, token incorrecto/vencido/ausente,
productos ocultos o inexistentes, stock insuficiente, envío por zona, liberación
perezosa y por barrido sin doble liberación, y documentación Swagger.
Los fixtures usan productos, categoría y tarifa propios y se eliminan al terminar.

## Pendiente o fuera de alcance

- Tarifas reales de envío: `ShippingRate` sigue vacía en el seed. Sin tarifa para una
  zona, repartidor responde 422. Retiro en local funciona.
- Identificación: se valida formato y longitud, no el dígito verificador.
- Rate limiting de creación de pedidos: corresponde al gateway (DEMO-18 / perímetro).
- El texto de `documentation/swagger.ts` aún indica que pedidos no tiene endpoints;
  se dejó sin modificar por ser un archivo compartido.
