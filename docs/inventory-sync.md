# DEMO-13 — Sincronización de inventario con el ERP

Este documento detalla la sincronización periódica del inventario desde el simulador ERP hacia la proyección local de catálogo en PostgreSQL, cumpliendo con los criterios de aceptación de **DEMO-13**.

## Arquitectura y flujo

```
┌─────────────────┐       GET /v1/inventory?cursor=...       ┌────────────────────────┐
│  Simulador ERP  │ ◄─────────────────────────────────────── │  Worker ERP            │
│  (puerto 3003)  │ ───────────────────────────────────────► │  SyncInventoryUseCase │
└─────────────────┘        { items, nextCursor }             └───────────┬────────────┘
                                                                         │
                                       Contrato interno protegido         │ Reconciliación con reservas
                                       (InventoryProjectionRepository)    │ y ventas no exportadas
                                                                         ▼
                                                             ┌────────────────────────┐
                                                             │  PostgreSQL            │
                                                             │  - Inventory           │
                                                             │  - ErpSyncCheckpoint   │
                                                             └───────────┬────────────┘
                                                                         │
                                                                         │ Lectura de catálogo
                                                                         ▼
                                                             ┌────────────────────────┐
                                                             │  API NestJS & Web      │
                                                             │  available = onHand    │
                                                             │             - reserved │
                                                             └────────────────────────┘
```

El worker es responsable de adaptar el formato del ERP mediante la capa anticorrupción (`ErpPort`), conciliar las existencias y actualizar la proyección en la base de datos de commerce.

---

## Criterios de Aceptación implementados

### 1. Importación paginada con checkpoint y ejecución periódica sin solapamiento

- **Paginación:** `SyncInventoryUseCase` solicita el inventario al ERP en lotes paginados utilizando cursores opacos (`nextCursor`).
- **Checkpoint persistente:** La tabla versionada `ErpSyncCheckpoint` almacena el cursor actual, el índice de página procesada, la cantidad de items sincronizados y el estado (`in_progress`, `idle`, `failed`).
- **Recuperación tras interrupción:** Si la sincronización se interrumpe (caída de red, reinicio del worker o timeout), la siguiente ejecución detecta el checkpoint en progreso y reanuda exactamente desde el último cursor guardado sin reiniciar desde cero.
- **Sin solapamiento:** El worker mantiene una bandera de ejecución activa (`running = true`) y un temporizador no bloqueante (`unref()`). Si una sincronización tarda más que el intervalo configurado, las llamadas concurrentes son descartadas inmediatamente sin superponerse.

### 2. Contrato interno protegido

- El worker implementa `InventoryProjectionRepository` (`PgInventoryProjectionRepository`), un contrato tipado y restringido que:
  - Solo tiene permisos de escritura sobre la tabla de proyección `Inventory` y la tabla de checkpoint `ErpSyncCheckpoint`.
  - **No escribe** en las tablas privadas de pedidos ni pagos (`Order`, `OrderItem`, `Payment`, `GuestCustomer`, `StockReservation`).
  - Las consultas a pedidos y reservas son estrictamente de solo lectura (`SELECT`).

### 3. Conciliación de stock y rechazo de snapshots antiguos

Para evitar **doble descuento** o **sobreventa** (_overselling_):

1. **Rechazo de snapshots antiguos:** Cada producto registra su marca temporal de sincronización (`Inventory.syncedAt`). Si el snapshot del ERP tiene una fecha anterior a la ya sincronizada (`erpUpdatedAt < syncedAt`), el item es rechazado como obsoleto (`stale_snapshot_rejected`).
2. **Deducción de ventas locales no exportadas:**
   Si una orden ha sido confirmada localmente pero su venta aún no ha sido exportada al ERP (o fue exportada después de la fecha del snapshot del ERP), el ERP aún cuenta esas unidades como disponibles en su almacén. El conciliador calcula:
   $$\text{unexportedQty} = \sum \text{OrderItem.quantity} \quad (\text{para órdenes confirmadas con exportación pendiente})$$
   $$\text{effectiveOnHand} = \max(0, \text{erpAvailable} - \text{unexportedQty})$$
3. **Respeto a reservas activas:**
   Se consultan las reservas activas no expiradas (`reservedQty`). Para preservar la restricción de integridad de PostgreSQL (`"reserved" <= "onHand"`):
   $$\text{finalOnHand} = \max(\text{reservedQty}, \text{effectiveOnHand})$$
   En el catálogo, la disponibilidad pública se calcula como:
   $$\text{availableQuantity} = \max(0, \text{finalOnHand} - \text{reservedQty})$$

### 4. Resistencia ante fallos

- Si el ERP no responde o se produce un timeout, el error se captura en `ErpSyncCheckpoint.lastError`, el cursor previo se conserva y el worker reintenta en el siguiente intervalo programado sin abortar el proceso principal.

### 5. Demostración y verificación del catálogo

- Al modificar el inventario en el simulador ERP (vía SQL o administración demo), en el siguiente intervalo documentado (por defecto 30 segundos) el worker sincroniza el cambio y la API de catálogo (`GET /api/v1/products`) refleja inmediatamente el nuevo `availableQuantity` e `inStock`.

---

## Variables de Entorno del Worker

| Variable                     | Descripción                                               | Valor por defecto |
| :--------------------------- | :-------------------------------------------------------- | :---------------- |
| `INVENTORY_SYNC_ENABLED`     | Habilita o desactiva la tarea periódica de sincronización | `true`            |
| `INVENTORY_SYNC_INTERVAL_MS` | Intervalo en milisegundos entre ciclos de sincronización  | `30000` (30 s)    |
| `INVENTORY_SYNC_TIMEOUT_MS`  | Tiempo límite en milisegundos para una ejecución completa | `10000` (10 s)    |
| `ERP_PAGE_SIZE`              | Cantidad de registros por página solicitados al ERP       | `20`              |

---

## Comandos de Prueba

```bash
# Pruebas unitarias de sincronización, conciliación y checkpoints
pnpm --filter @groupmg/worker-erp run test:unit

# Pruebas de integración con base de datos real (PostgreSQL)
pnpm --filter @groupmg/worker-erp run test:db
```
