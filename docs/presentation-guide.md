# Guion y Checklist de Presentación de la Demo (DEMO-16)

Esta guía permite a cualquier integrante del equipo reproducir, verificar y presentar la demostración completa de **GroupMG Commerce** de manera ordenada, confiable y sin configuraciones ocultas.

---

## 1. Arranque desde un Clon Limpio

### Requisitos del sistema

- **Node.js 24** (según `.nvmrc` y `package.json`).
- **pnpm 12.5.1** (`corepack enable && corepack prepare pnpm@12.5.1 --activate`).
- **Docker y Docker Compose v2** en ejecución.
- Git y terminal Bash / PowerShell.

### Paso a paso de inicialización

```bash
# 1. Clonar el repositorio y acceder
git clone https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo.git
cd GroupMG-Commerce-Demo

# 2. Copiar variables de entorno locales (preconfiguradas para demo)
cp .env.example .env
# En PowerShell: Copy-Item .env.example .env

# 3. Instalar dependencias reproducibles con lockfile congelado
pnpm install --frozen-lockfile

# 4. Compilar todos los paquetes y aplicaciones del monorepo
pnpm run build

# 5. Levantar todos los servicios en Docker con readiness real
pnpm run demo:up

# 6. Cargar datos iniciales en PostgreSQL y en el Simulador ERP
pnpm run demo:seed

# 7. Ejecutar diagnóstico de salud del entorno
pnpm run demo:doctor
```

Si `pnpm demo:doctor` finaliza en verde, todos los contenedores y puertos loopback (`127.0.0.1`) están listos para la demostración.

---

## 2. Productos de Ejemplo y Escenarios de Pago

### Productos cargados en la demo (`docs/demo-products.json`)

| SKU           | Nombre                | Precio (USD) | IVA (15%) | Stock Inicial | Comportamiento en la demo                                    |
| ------------- | --------------------- | ------------ | --------- | ------------- | ------------------------------------------------------------ |
| `MG-DEMO-001` | Smartphone Pro        | $499.00      | $74.85    | 10 u.         | **Producto principal** para el guion de compra feliz.        |
| `MG-DEMO-002` | Auriculares Bluetooth | $79.99       | $12.00    | 25 u.         | Ideal para pruebas de compra múltiple en carrito.            |
| `MG-DEMO-003` | Monitor Curvo 27"     | $299.00      | $44.85    | 8 u.          | Producto con stock intermedio.                               |
| `MG-DEMO-012` | Smartwatch Fitness V1 | $149.00      | $22.35    | **0 u.**      | **Caso agotado**: botón de compra deshabilitado en frontend. |

### Escenarios de pago configurables (`.env`)

1. **Modo Simulado (`PAYMENTS_MODE=simulated` - Recomendado para presentaciones sin internet)**:
   - Permite aprobar o rechazar transacciones directamente desde la interfaz web o mediante el script de smoke test sin requerir saldo ni conexión a PayPhone.
2. **Modo Sandbox (`PAYMENTS_MODE=sandbox` - Para demostración con pasarela PayPhone)**:
   - Requiere `PAYPHONE_API_TOKEN` de pruebas.
   - Teléfono de prueba en Ecuador: `0991234567`.
   - Permite aprobar la solicitud en la app sandbox de PayPhone o rechazarla intencionalmente para ver la liberación de reserva.

---

## 3. Checklist Previo a la Demostración (Pre-flight)

Antes de iniciar la presentación ante el cliente o equipo técnico, verificar cada elemento de la lista:

- [ ] **Docker activo:** `docker compose ps` muestra todos los servicios en estado `running` o `healthy`.
- [ ] **Diagnóstico en verde:** Ejecutar `pnpm demo:doctor`; verificar que no existan puertos abiertos al exterior (`0.0.0.0`) y que los secretos estén enmascarados.
- [ ] **Datos iniciales limpios:** Ejecutar `pnpm demo:seed` para restaurar inventario y ventas base.
- [ ] **Smoke test aprobado:** Ejecutar `pnpm demo:smoke` para certificar la ruta APISIX $\to$ API $\to$ Pagos.
- [ ] **Colas de mensajería limpias:** Comprobar en RabbitMQ (`http://localhost:15672`, usuario/password: `commerce` / `local-only-demo`) que las colas `erp.sales.v1` y `erp.sales.v1.dlq` estén en 0 mensajes pendientes.
- [ ] **Pestañas del navegador preparadas en orden:**
  1. `http://localhost:8080/catalogo` — Tienda web (Storefront).
  2. `http://localhost:8080/api/docs` — Swagger de la API de Comercio.
  3. `http://localhost:3003/docs` — Swagger del Simulador ERP.
  4. `http://localhost:15672` — Panel de control de RabbitMQ.
- [ ] **Terminal auxiliar abierta:** Para mostrar logs en vivo durante la compra con:
  ```bash
  docker compose logs -f --tail=20 api worker-erp
  ```

---

## 4. Guion 1: Recorrido Completo de Compra Exitosa (Happy Path)

**Objetivo:** Demostrar el flujo integral desde el catálogo hasta el registro asíncrono en el ERP, resaltando la consistencia transaccional y la observabilidad.

| Paso                       | Acción en Pantalla                                                                                                        | Narrativa técnica para el presentador                                                                                                                                                                       | Evidencia verificable                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **1. Catálogo**            | Abrir `http://localhost:8080/catalogo`. Filtrar por categoría o buscar "Smartphone".                                      | "El storefront consulta el catálogo a través de APISIX. El stock disponible descuenta automáticamente las reservas activas en PostgreSQL sin bloquear lecturas."                                            | `MG-DEMO-001` muestra 10 unidades disponibles y precio con desglose de IVA (15%).                         |
| **2. Carrito**             | Entrar a `MG-DEMO-001`, agregar 1 unidad y hacer clic en el carrito (`/carrito`).                                         | "El carrito calcula importes en enteros (centavos) para evitar errores de redondeo de punto flotante."                                                                                                      | Subtotal: \$499.00, IVA 15%: \$74.85, Total: \$573.85.                                                    |
| **3. Checkout**            | Ir a `/checkout`. Ingresar datos del cliente demo (Cédula: `1710034065`, Nombre: `Cliente Demo`, Teléfono: `0991234567`). | "Al enviar el formulario, la API crea la orden y reserva el stock inmediatamente con expiración de 5 minutos. Si el usuario abandona la compra, el stock vuelve al inventario automáticamente."             | La orden se crea con estado `pending_payment`. El stock reservado en BD pasa de 0 a 1.                    |
| **4. Pago**                | Proceder al pago. En modo simulado, hacer clic en "Aprobar pago" (o responder al webhook en sandbox).                     | "La pasarela notifica el pago mediante un webhook firmado con HMAC SHA-256 hacia APISIX. La API valida la firma antes de procesar cualquier cambio."                                                        | La vista web navega a `/confirmacion` con número de orden y mensaje de éxito.                             |
| **5. Outbox y Mensajería** | Señalar la terminal de logs (`docker compose logs -f api worker-erp`).                                                    | "Para garantizar que ninguna venta se pierda si RabbitMQ cae, usamos el patrón Transaccional Outbox: la orden y el evento `order.confirmed.v1` se guardaron en la misma transacción atómica de PostgreSQL." | En logs aparece: `[OutboxPublisher] Published order.confirmed.v1 for order <id> (correlationId: <uuid>)`. |
| **6. Consumo ERP**         | En el panel de logs y en Swagger ERP (`http://localhost:3003/docs` -> `GET /api/v1/sales`).                               | "El worker ERP consume el evento de RabbitMQ de forma desacoplada y registra la venta en el ERP mediante su API idempotente."                                                                               | La venta aparece registrada en el simulador ERP vinculada al `orderId` de la tienda.                      |

---

## 5. Guion 2: Resiliencia ante Caída y Recuperación de ERP (Zero Duplicates)

**Objetivo:** Demostrar que una caída total del ERP no afecta la experiencia de compra del usuario y que la recuperación ocurre sin duplicar datos ni perder ventas.

| Paso                            | Acción en Pantalla / Terminal                                                           | Narrativa técnica para el presentador                                                                                                                                                                      | Evidencia verificable                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **1. Simular caída del ERP**    | En la terminal: `docker compose stop erp-simulator`                                     | "Vamos a simular una falla crítica en el ERP corporativo deteniendo su servicio por completo."                                                                                                             | El simulador queda inalcanzable (`localhost:3003` no responde).                                                  |
| **2. Realizar nueva compra**    | En la web (`localhost:8080`), realizar una compra de `MG-DEMO-002` y completar el pago. | "El cliente completa su compra normalmente y recibe su confirmación. La tienda no se bloquea ni muestra errores aunque el sistema contable esté caído."                                                    | Orden confirmada exitosamente en la tienda web (`/confirmacion`).                                                |
| **3. Inspeccionar cola**        | Abrir RabbitMQ (`http://localhost:15672` -> Queues -> `erp.sales.v1`).                  | "La orden confirmada fue enviada a la cola. El worker intentó conectarse al ERP, detectó el fallo de red y aplicó un nack con reintento seguro sin descartar el mensaje."                                  | La cola `erp.sales.v1` retiene 1 mensaje listo (`Ready: 1`). Logs muestran advertencia de reintento con backoff. |
| **4. Restaurar el ERP**         | En la terminal: `docker compose start erp-simulator`                                    | "Restauramos el servicio del ERP simulador."                                                                                                                                                               | El contenedor vuelve a estar saludable.                                                                          |
| **5. Procesamiento automático** | Observar logs del `worker-erp` y la consola de RabbitMQ.                                | "En el siguiente reintento del worker, el mensaje se procesa inmediatamente y se exporta la venta pendiente."                                                                                              | El mensaje sale de la cola de RabbitMQ (`Ready: 0`). Logs muestran: `Sale exported successfully to ERP`.         |
| **6. Demostrar no duplicación** | Consultar en el simulador (`http://localhost:3003/docs` -> `GET /api/v1/sales`).        | "Si RabbitMQ reentrega el evento por cualquier motivo, el worker detecta el `orderId` ya procesado en la tabla de control y responde con idempotencia, garantizando exactamente una sola venta en el ERP." | Una única venta registrada para dicho pedido.                                                                    |

---

## 6. Limitaciones de la Demo

Es fundamental clarificar durante la presentación los límites del alcance acordado:

1. **Dinero y pagos:** No se procesa dinero real. Se utiliza la pasarela PayPhone en entorno sandbox o el modo simulado de prueba local.
2. **ERP simulado:** El ERP es un servicio HTTP ligero (`@groupmg/erp-simulator`) con su propia base de datos aislada (`erp_demo`), diseñado para emular la API de inventario y ventas de un ERP real.
3. **Mononodo local:** La arquitectura está desplegada en un único host Docker Compose, no en un clúster Kubernetes de producción.
4. **Compra invitada (Guest Checkout):** El flujo no requiere creación previa de cuenta ni login; la consulta de historial privado de compras está prevista en el backlog post-demo (DEMO-17 opcional).
5. **WAF Coraza:** Las reglas de perímetro y bloqueo activo de Coraza WASM están documentadas como extensión opcional (DEMO-18).

---

## 7. Procedimiento de Recuperación y Reset Seguro

### Reinicio no destructivo (conserva base de datos)

Si un servicio se detiene o no responde durante un ensayo:

```bash
pnpm run demo:down
pnpm run demo:up
```

### Limpieza y reset completo de la demo

Si se realizaron múltiples compras y se desea reiniciar el inventario al estado original de la presentación:

```bash
# Requiere bandera explícita obligatoria de confirmación:
pnpm run demo:reset --confirm-demo-reset
```

Este comando:

1. Elimina órdenes, pagos, eventos y reservas de la base de datos `commerce_demo`.
2. Vuelve a ejecutar las migraciones de Prisma.
3. Carga el seed oficial de productos con sus cantidades originales.
4. Reinicia la base de datos del simulador ERP (`erp_demo`).
5. Protege contra ejecuciones accidentales en entornos que no sean de demostración.
