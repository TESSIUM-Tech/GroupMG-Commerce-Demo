# Backlog del demo — GroupMG Commerce

Repositorio destino: `TESSIUM-Tech/GroupMG-Commerce-Demo`.

Estado: 18 issues publicados y verificados en GitHub (#1 a #18).
Los identificadores `DEMO-xx` se conservan como referencias de planificación. Cada sección enlaza su issue real.

## Alcance confirmado

Compra completa con pago de prueba y ERP simulado reemplazable. El demo debe
mostrar catálogo, carrito, checkout, confirmación y registro asíncrono de la venta.
No se procesará dinero real ni se conectará un ERP real.

Supuestos de implementación a resolver en DEMO-01: compra como invitado con datos
mínimos del cliente, un almacén, una moneda y una política sencilla de envío.
No se fijan responsables, fechas ni estimaciones sin conocer disponibilidad del equipo.

Quedan fuera de la primera demo: facturación fiscal, promociones, múltiples monedas,
logística real, panel administrativo completo, alta disponibilidad y Kubernetes.
Autenticación de clientes y WAF se separan como mejoras opcionales, no como trabajo terminado.

## Organización en GitHub

Entregas organizadas mediante etiquetas phase:M1 a phase:M4 y phase:post-demo. No se crearon milestones ni un Project: la conexión disponible no expone esas operaciones.

| Milestone                        | Resultado demostrable                                          | Issues            |
| -------------------------------- | -------------------------------------------------------------- | ----------------- |
| M1 — Catálogo navegable          | Productos persistidos y catálogo web conectado                 | DEMO-01 a DEMO-06 |
| M2 — Compra con pago de prueba   | Carrito, pedido, pago sandbox y confirmación                   | DEMO-07 a DEMO-10 |
| M3 — ERP simulado y recuperación | Venta exportada, inventario sincronizado y fallos recuperables | DEMO-11 a DEMO-13 |
| M4 — Demo reproducible           | Entorno, pruebas y guion de presentación                       | DEMO-14 a DEMO-16 |
| Posterior al demo                | Mejoras que no bloquean la presentación inicial                | DEMO-17 y DEMO-18 |

Etiquetas propuestas: `demo`, `priority:P0`, `priority:P1`, `priority:P2`,
`area:frontend`, `area:backend`, `area:data`, `area:integration`, `area:devops`,
`area:qa`, `area:security`, `type:decision`, `type:feature`, `type:task`.

P0: bloquea el recorrido principal. P1: necesario para presentar la integración
confiablemente. P2: opcional para esta demo.

Tablero sugerido: **Backlog → Ready → In progress → In review → Done**.
Usar el estado nativo del tablero, sin duplicarlo en etiquetas.
Cada issue pasa a Ready cuando sus dependencias están resueltas; a Done cuando
cumple sus criterios y su PR está integrado. Un commit por sí solo no cierra el issue.

Al publicar: comprobar issues/milestones existentes para evitar duplicados, crear
primero las etiquetas y milestones, sustituir DEMO-xx por enlaces reales y enlazar
los PR con `Closes #numero`. No crear todavía fechas, asignaciones ni un Project
nuevo si el equipo ya dispone de uno.

## Decisiones locales DEMO-01

Reglas acordadas: [demo-rules.md](demo-rules.md). Catálogo: [demo-products.json](demo-products.json).
PayPhone API Sale seleccionado; rechazo simulado autorizado solo en demo/tests.
Cuenta creada según el usuario; smoke de sandbox pendiente. DEMO-09 requiere revisar
el criterio de firma para este proveedor. Los criterios originales se conservan abajo.

## Issues listos para publicar

### DEMO-01 — Definir las reglas y los datos de la demo

Issue publicado: [#1](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/1).

**Milestone:** M1 — Catálogo navegable\
**Etiquetas:** `demo`, `priority:P0`, `type:decision`\
**Dependencias:** ninguna.

**Objetivo:** cerrar las decisiones mínimas que afectan pedidos, datos y pago.

**Criterios de aceptación**

- [x] Documentar moneda, envío, impuestos y política de stock de la demo.
- [x] Seleccionar un ORM y un proveedor de pago con cuenta sandbox disponible; no implementar dos pasarelas.
- [x] Confirmar compra como invitado, datos mínimos del cliente y acceso seguro al pedido.
- [x] Definir al menos 12 productos ficticios con SKU, categoría, precio, imagen autorizada y stock; incluir un agotado.
- [x] Acordar el guion: compra exitosa, pago rechazado, falta de stock y ERP temporalmente caído.

**Fuera de alcance:** credenciales en issues, cobros reales y ERP real.

Evidencia local: [demo-rules.md](demo-rules.md), [demo-products.json](demo-products.json), [presentation-guide.md](presentation-guide.md). Moneda USD, IVA 15% Ecuador, Prisma ORM, pasarela PayPhone API Sale sandbox, compra como invitado con credencial efímera de 32 bytes y catálogo base de 12 productos con `MG-DEMO-012` agotado.

### DEMO-02 — Crear persistencia, migraciones y seed reproducible

Issue publicado: [#2](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/2).

**Milestone:** M1 — Catálogo navegable\
**Etiquetas:** `demo`, `priority:P0`, `area:data`, `type:feature`\
**Dependencias:** DEMO-01.

**Objetivo:** conectar la API a PostgreSQL con un esquema inicial versionado.

**Criterios de aceptación**

- [x] Crear migraciones de catálogo, inventario, clientes invitados, pedidos/items, pagos, recibos webhook y outbox.
- [x] Definir SKU y referencias de proveedor únicas; usar importes en unidades menores y moneda explícita.
- [x] Aplicar restricciones para cantidades/precios y relaciones; documentar estados permitidos.
- [x] El seed puede repetirse sin duplicar datos y no contiene información personal real.
- [x] Documentar comandos pnpm para migrar y cargar una base vacía; comprobar persistencia tras reiniciar PostgreSQL.

**Fuera de alcance:** panel de administración y migración de información de producción.

Evidencia local: [persistencia](persistence.md), migración inicial aplicada, seed repetido,
seis pruebas de integración aprobadas y huella de IDs/stock conservada tras reiniciar PostgreSQL.

### DEMO-03 — Conectar la API y definir validación y errores HTTP

Issue publicado: [#3](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/3).

**Milestone:** M1 — Catálogo navegable\
**Etiquetas:** `demo`, `priority:P0`, `area:backend`, `type:task`\
**Dependencias:** DEMO-02.

**Objetivo:** establecer una base consistente para los endpoints del demo.

**Criterios de aceptación**

- [x] Validar la configuración al arrancar sin imprimir secretos y conectar el repositorio PostgreSQL.
- [x] Validar DTO en runtime, rechazar campos no permitidos y responder errores consistentes sin stacks internos.
- [x] Añadir correlationId a respuestas/logs y documentar los endpoints iniciales.
- [x] Mantener liveness y agregar readiness de PostgreSQL con respuesta no exitosa cuando no esté disponible.
- [x] Comprobar entrada inválida y caída de base de datos con pruebas de integración.

Evidencia local: [api-base](api-base.md), validación de variables de entorno al arranque sin imprimir credenciales, repositorio PostgreSQL `CatalogRepository` conectado, trazabilidad con `x-correlation-id` en cabeceras/cuerpo/logs estructurados, liveness y readiness de PostgreSQL con 503 controlado sin fuga de stacks, validación DTO en runtime con rechazo estricto de campos no permitidos y formato uniforme de errores HTTP. 14 pruebas de integración de API aprobadas (20 pruebas totales en monorepo) y verificación en vivo a través del API Gateway APISIX en Docker.

### DEMO-04 — Diseñar las pantallas y estados del recorrido de compra

Issue publicado: [#4](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/4).

**Milestone:** M1 — Catálogo navegable\
**Etiquetas:** `demo`, `priority:P0`, `area:frontend`, `type:task`\
**Dependencias:** DEMO-01.

**Objetivo:** definir una interfaz coherente antes de conectar todas las vistas.

**Criterios de aceptación**

- [x] Definir estilos compartidos y componentes básicos para formularios, tarjetas, precios y alertas.
- [x] Cubrir catálogo, ficha, carrito, checkout, pago pendiente y confirmación para móvil y escritorio.
- [x] Incluir carga, vacío, error y producto agotado, con acciones de recuperación claras.
- [x] Navegación por teclado, foco visible, etiquetas de formulario y contraste legible.

**Fuera de alcance:** un sistema de diseño completo o rediseño de marca.

Evidencia local: [frontend-validation.md](frontend-validation.md). Cobertura de las 8 vistas principales, estados vacíos, botón de compra deshabilitado en agotados, 40 comprobaciones de accesibilidad DOM, contraste auditado y foco visible.

### DEMO-05 — Implementar API de catálogo e inventario disponible

Issue publicado: [#5](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/5).

**Milestone:** M1 — Catálogo navegable\
**Etiquetas:** `demo`, `priority:P0`, `area:backend`, `type:feature`\
**Dependencias:** DEMO-02, DEMO-03.

**Objetivo:** consultar productos reales desde la base de la demo.

**Criterios de aceptación**

- [x] Implementar listado paginado, búsqueda y filtro por categoría, y detalle por identificador estable.
- [x] Devolver precio, moneda, imagen y disponibilidad; ocultar productos no publicados.
- [x] Limitar paginación y validar filtros; devolver 404 para un producto inexistente.
- [x] Probar filtro, paginación, producto agotado y colección vacía.

**Fuera de alcance:** búsqueda avanzada y caché perimetral.

Evidencia local: [catalog-api.md](catalog-api.md). Endpoints `GET /api/v1/products` y `GET /api/v1/products/:sku`, cálculo en tiempo real de `availableQuantity = max(0, onHand - reserved)`, validación de parámetros de consulta y suites de pruebas unitarias y de integración HTTP aprobadas.

### DEMO-06 — Conectar catálogo y ficha de producto en Next.js

Issue publicado: [#6](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/6).

**Milestone:** M1 — Catálogo navegable\
**Etiquetas:** `demo`, `priority:P0`, `area:frontend`, `type:feature`\
**Dependencias:** DEMO-04, DEMO-05.

**Objetivo:** explorar catálogo y disponibilidad desde web usando la API.

**Criterios de aceptación**

- [x] Renderizar datos de API en catálogo y ficha, con búsqueda/filtros conservados en URL.
- [x] Resolver correctamente las URLs de API tanto en desarrollo local como dentro de Docker.
- [x] Mostrar carga, error con reintento, vacío y 404; no sustituir errores por datos ficticios silenciosamente.
- [x] Mostrar precio/moneda y agotados correctamente; reservar el control de agregar al carrito para DEMO-07.
- [x] Verificar uso móvil, teclado y metadatos básicos del producto.

Evidencia local: Componentes `CatalogView` y `ProductView` en Next.js conectando con la API a través de APISIX, preservando querystring en URL, gestionando estados de carga y error, y verificando adaptabilidad móvil en 360px a 1920px.

### DEMO-07 — Implementar carrito y persistencia local

Issue publicado: [#7](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/7).

**Milestone:** M2 — Compra con pago de prueba\
**Etiquetas:** `demo`, `priority:P0`, `area:frontend`, `type:feature`\
**Dependencias:** DEMO-06.

**Objetivo:** preparar la selección de productos antes de crear el pedido.

**Criterios de aceptación**

- [x] Agregar, quitar y modificar cantidades; sumar un mismo producto sin duplicar líneas.
- [x] Mantener el carrito después de recargar, sin almacenar datos personales ni credenciales.
- [x] Mostrar subtotal orientativo y carrito vacío; validar cantidad positiva y límites visibles.
- [x] Avisar cuando un producto ya no esté disponible o su precio cambie al revalidar.
- [x] Probar modificación, eliminación y recuperación tras recarga.

**Nota:** el servidor recalcula los importes; el total del navegador nunca autoriza el cobro.

Evidencia local: Módulo `cart-storage.ts` con persistencia en `localStorage` (únicamente SKU y cantidad), componente `CartView`, control reactivo de unidades y suite de pruebas `apps/web/test/cart-storage.test.cjs` aprobada.

### DEMO-08 — Crear pedidos pendientes con control de stock e idempotencia

Issue publicado: [#8](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/8).

**Milestone:** M2 — Compra con pago de prueba\
**Etiquetas:** `demo`, `priority:P0`, `area:backend`, `type:feature`\
**Dependencias:** DEMO-01, DEMO-03, DEMO-05.

**Objetivo:** persistir un pedido correcto a partir de SKU/cantidades y datos del cliente invitado.

**Criterios de aceptación**

- [x] Recalcular totales desde la base y guardar snapshot de productos/precios y datos mínimos del cliente.
- [x] Crear el pedido en transacción con reserva de stock según DEMO-01; impedir sobreventa concurrente.
- [x] Repetir una solicitud con la misma clave idempotente no crea otro pedido; rechazar payload diferente con la misma clave.
- [x] Definir expiración/liberación de reservas y estados del pedido; rechazar transiciones inválidas.
- [x] Proteger la consulta del pedido invitado con una credencial opaca y evitar acceso por ID adivinable.
- [x] Probar total manipulado, dos compras del último artículo e idempotencia.

Evidencia local: [orders.md](orders.md). `CreateOrderUseCase` con transacción atómica de reserva de stock (`reserved += quantity`), idempotencia verificada con hash criptográfico, token efímero Bearer de 32 bytes y pruebas unitarias/de base de datos aprobadas.

### DEMO-09 — Integrar pago sandbox y procesar webhooks

Issue publicado: [#9](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/9).

**Milestone:** M2 — Compra con pago de prueba\
**Etiquetas:** `demo`, `priority:P0`, `area:backend`, `area:integration`, `type:feature`\
**Dependencias:** DEMO-08.

**Objetivo:** confirmar pedidos a partir de eventos verificados del proveedor elegido.

**Criterios de aceptación**

- [x] Crear sesiones de pago únicamente en modo prueba y desde importes calculados por el backend.
- [x] Verificar firma usando el cuerpo original del webhook y validar la relación pedido/importe/moneda.
- [x] Persistir y deduplicar eventos del proveedor; pedido confirmado y evento outbox se guardan atómicamente.
- [x] Manejar pago rechazado, cancelado y eventos fuera de orden sin volver a confirmar ni cobrar.
- [x] Definir qué ocurre con un pago tardío después de expirar la reserva, sin confirmar stock inexistente.
- [x] Probar firma inválida, webhook duplicado y ruta vía gateway; documentar cómo recibir eventos sandbox.

**Fuera de alcance:** dinero real, almacenamiento de tarjetas y reembolsos reales.

Evidencia local: [payments.md](payments.md). Pasarela PayPhone API Sale en modo sandbox y simulado, verificación estricta de firma HMAC SHA-256 en webhooks, confirmación atómica con Outbox y script de prueba `payments-gateway-smoke.cjs`.

### DEMO-10 — Conectar checkout y estado final del pedido

Issue publicado: [#10](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/10).

**Milestone:** M2 — Compra con pago de prueba\
**Etiquetas:** `demo`, `priority:P0`, `area:frontend`, `type:feature`\
**Dependencias:** DEMO-04, DEMO-07, DEMO-08, DEMO-09.

**Objetivo:** completar la compra y mostrar su estado confirmado por el backend.

**Criterios de aceptación**

- [x] Validar los datos mínimos del cliente y mostrar resumen actualizado antes del pago.
- [x] Conservar la clave idempotente al reintentar y bloquear dobles envíos desde la interfaz.
- [x] Integrar la experiencia del proveedor sandbox sin exponer secretos al navegador.
- [x] Mostrar pendiente, confirmado, rechazado y cancelado consultando el backend; un redirect de éxito no prueba el pago.
- [x] Vaciar el carrito al confirmar y conservarlo cuando se rechaza/cancela; permitir recuperar un estado tras recarga.
- [x] Evitar indexación y caché compartida de checkout y datos del pedido.

Evidencia local: Vistas `CheckoutView`, `PaymentView` y `ConfirmationView`, polling de estado real en base de datos mediante token Bearer, retención de clave de idempotencia y vaciado condicional de carrito.

### DEMO-11 — Crear simulador ERP con contrato y fallos controlables

Issue publicado: [#11](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/11).

**Milestone:** M3 — ERP simulado y recuperación\
**Etiquetas:** `demo`, `priority:P1`, `area:integration`, `type:feature`\
**Dependencias:** DEMO-01, DEMO-02.

**Objetivo:** disponer de un ERP ficticio reproducible detrás de ErpPort.

**Criterios de aceptación**

- [x] Implementar consulta paginada de inventario y registro de venta con referencia/idempotency key.
- [x] Separar DTO del simulador y modelo interno mediante el adaptador de la capa anticorrupción.
- [x] Simular latencia, timeout y errores 5xx activables solo en el entorno demo.
- [x] Conservar ventas y deduplicación entre reinicios, con un mecanismo explícito de reset de datos demo.
- [x] Documentar contrato y ejecución en Compose; permitir reemplazar el adaptador sin cambiar casos de uso.

Evidencia local: [erp-simulator.md](erp-simulator.md). Microservicio `erp-simulator` en puerto 3003 con OpenAPI/Swagger, base de datos propia `erp_demo`, inyección de fallos programables vía `/api/v1/faults` y adaptador `SimulatedErpAdapter` en el worker.

### DEMO-12 — Publicar outbox y exportar ventas por RabbitMQ

Issue publicado: [#12](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/12).

**Milestone:** M3 — ERP simulado y recuperación\
**Etiquetas:** `demo`, `priority:P1`, `area:backend`, `area:integration`, `type:feature`\
**Dependencias:** DEMO-09, DEMO-11.

**Objetivo:** entregar las ventas confirmadas al ERP aunque exista una caída temporal.

**Criterios de aceptación**

- [x] Declarar exchange/colas durables, routing de order.confirmed.v1, reintentos limitados y DLQ.
- [x] Publicar desde outbox con publisher confirms, detección de mensajes sin ruta y marcado después de confirmación.
- [x] Validar el evento en runtime; ack del consumidor solo después de registrar el resultado persistente.
- [x] Deduplicar por eventId y usar idempotencia/reconciliación del ERP para el caso de respuesta perdida.
- [x] Probar caída del broker, reinicio entre publicación y marcado, fallo ERP y reentrega sin venta duplicada.
- [x] Documentar cómo inspeccionar y reprocesar una DLQ sin perder trazabilidad.

Evidencia local: [messaging.md](messaging.md). Publicador `OutboxPublisher` con `publisher confirms`, colas durables `erp.sales.v1` y `erp.sales.v1.dlq`, consumidor `ErpSalesConsumer` con deduplicación por `orderId` y script CLI `erp-sales-dlq.cjs`.

### DEMO-13 — Sincronizar inventario y demostrar su actualización

Issue publicado: [#13](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/13).

**Milestone:** M3 — ERP simulado y recuperación\
**Etiquetas:** `demo`, `priority:P1`, `area:integration`, `area:backend`, `type:feature`\
**Dependencias:** DEMO-05, DEMO-08, DEMO-11, DEMO-12.

**Objetivo:** reflejar cambios del ERP simulado sin romper reservas/pedidos locales.

**Criterios de aceptación**

- [x] Implementar importación paginada con checkpoint, timeout y ejecución periódica configurable sin solapamiento.
- [x] Actualizar la proyección mediante un contrato interno protegido, no escribiendo tablas privadas de pedidos.
- [x] Rechazar snapshots antiguos y conciliar stock ERP con reservas locales y ventas aún no exportadas para evitar doble descuento/sobreventa.
- [x] Probar sincronización repetida, interrupción entre páginas y recuperación desde checkpoint.
- [x] Modificar stock en el simulador y verificar el cambio en catálogo dentro del intervalo documentado.

**Fuera de alcance:** múltiples almacenes y caché Redis; añadir caché cuando exista una necesidad medida.

Evidencia local: [inventory-sync.md](inventory-sync.md). Contrato interno `InventoryProjectionRepository` en `apps/worker-erp/src/sync/`, caso de uso `SyncInventoryUseCase`, migración `202610200001_inventory_sync_checkpoint` y worker `InventorySyncWorker`. Suite de pruebas unitarias cubriendo conciliación de stock con deducción de ventas pendientes de exportar, reservas activas, rechazo de snapshots antiguos, interrupción entre páginas y recuperación mediante checkpoints persistentes. Pruebas aprobadas (14 pruebas en worker-erp).

### DEMO-14 — Preparar el entorno de demo y su diagnóstico

Issue publicado: [#14](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/14).

**Milestone:** M4 — Demo reproducible\
**Etiquetas:** `demo`, `priority:P1`, `area:devops`, `type:task`\
**Dependencias:** DEMO-10, DEMO-12, DEMO-13.

**Objetivo:** levantar el recorrido completo sin configuraciones ocultas de la máquina del desarrollador.

**Criterios de aceptación**

- [x] Levantar apps, gateway, datos, RabbitMQ y simulador ERP con instrucciones reproducibles y readiness real.
- [x] Validar configuración/secretos de sandbox sin incluirlos en Git ni logs; mantener puertos de datos restringidos.
- [x] Mostrar correlationId/eventId y estado de exportación en logs para seguir una compra completa.
- [x] Documentar parada, reinicio, seed y recuperación; cualquier reset destructivo debe ser explícito y solo para datos demo.
- [x] Si se presenta por una URL pública, habilitar TLS, acceso limitado y ruta webhook sandbox probada; registrar dónde se aloja.

Evidencia local: [demo-environment.md](demo-environment.md). Configuración de Compose con readiness real (`api` verifica PostgreSQL mediante `/api/v1/health/readiness`, `web` mediante `/health` y `gateway` depende de `service_healthy`). Script automatizado de diagnóstico `scripts/demo-diagnostics.cjs` (`pnpm demo:doctor`) que comprueba puertos en loopback (127.0.0.1) y enmascara secretos. Reinicio destructivo seguro `scripts/demo-reset.cjs` con bandera obligatoria `--confirm-demo-reset`. Trazabilidad estructurada de compras con `correlationId`, `orderId` y `eventId`. Guía de publicación pública con túnel TLS y pruebas de webhook.

**Nota:** no mover PR a un runner compartido con producción. El runner propio depende de definir servidor, permisos y aislamiento; no bloquea usar la CI alojada por GitHub.

### DEMO-15 — Validar el recorrido completo y los fallos de integración

Issue publicado: [#15](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/15).

**Milestone:** M4 — Demo reproducible\
**Etiquetas:** `demo`, `priority:P1`, `area:qa`, `type:task`\
**Dependencias:** DEMO-14.

**Objetivo:** comprobar que el demo se puede presentar con resultados verificables.

**Criterios de aceptación**

- [x] Automatizar catálogo → carrito → pedido → confirmación y registro en ERP con dobles deterministas para CI.
- [x] Ejecutar además un smoke real del proveedor sandbox, documentando resultado sin registrar secretos ni datos personales.
- [x] Cubrir pago rechazado, webhook duplicado, stock concurrente, timeout ERP, reentrega y DLQ.
- [x] Integrar pruebas deterministas a CI junto con formato, tipos y build usando pnpm y lockfile congelado.
- [x] Verificar teclado y vista móvil de las pantallas principales; adjuntar evidencia de los casos y defectos abiertos.

Evidencia local: [integration-validation.md](qa/integration-validation.md). Suite determinista automatizada `test/full-journey-deterministic.test.cjs` integrada en `.github/workflows/ci.yml` (`pnpm run test:e2e:deterministic`), validando los 7 escenarios en CI (<100ms) sin dependencias externas: recorrido feliz completo, pago rechazado y liberación de reservas, webhook duplicado e idempotente, carrera concurrente por última unidad (HTTP 409), timeout y reintentos ante caída de ERP, deduplicación ante reentrega de eventos y enrutamiento a Dead Letter Queue (DLQ) para eventos inválidos. Smoke test reproducible mediante `pnpm demo:smoke` con validación HMAC y protección de PII/secretos. Auditoría de accesibilidad y matriz responsive documentada con capturas de pantalla.

### DEMO-16 — Preparar guion y checklist de presentación

Issue publicado: [#16](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/16).

**Milestone:** M4 — Demo reproducible\
**Etiquetas:** `demo`, `priority:P1`, `area:qa`, `type:task`\
**Dependencias:** DEMO-15.

**Objetivo:** permitir que otro integrante reproduzca la demostración.

**Criterios de aceptación**

- [x] Documentar arranque desde un clon limpio, productos de ejemplo y escenarios de pago de prueba.
- [x] Preparar un guion de compra exitosa y otro de caída/recuperación ERP con evidencia de ausencia de duplicados.
- [x] Incluir checklist previo: servicios listos, seed, conectividad, webhook y estado de colas.
- [x] Actualizar README/diagramas para distinguir implementación real, simulador y pendientes.
- [x] Registrar limitaciones de la demo y un procedimiento de recuperación sin borrar datos por sorpresa.

Evidencia local: [presentation-guide.md](presentation-guide.md). Documento integral que cubre el arranque paso a paso desde un clon limpio con lockfile congelado (`pnpm install --frozen-lockfile`), tabla de productos demo y casos de pago (simulado y sandbox PayPhone), checklist exhaustivo de pre-flight (puertos loopback, readiness real, seed y smoke test), guion narrativo de compra feliz con trazabilidad de eventos y guion de caída/recuperación del simulador ERP demostrando retención en colas RabbitMQ y cero ventas duplicadas mediante idempotencia. Actualización del `README.md` distinguiendo componentes implementados, simulador HTTP aislado y backlog opcional post-demo.

### DEMO-17 — Añadir cuentas de clientes e historial privado (opcional)

Issue publicado: [#17](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/17).

**Milestone:** Posterior al demo\
**Etiquetas:** `demo`, `priority:P2`, `area:backend`, `area:frontend`, `type:feature`\
**Dependencias:** DEMO-10.

**Objetivo:** evolucionar la compra invitada a cuentas con acceso a sus pedidos.

**Criterios de aceptación**

- [ ] Definir mecanismo de identidad y manejo de sesiones antes de implementar registro/login/logout.
- [ ] Proteger historial y detalle por propietario con pruebas de acceso cruzado.
- [ ] Definir vinculación segura de compras invitadas; no asociarlas solo por conocer un correo.
- [ ] Limitar intentos de autenticación y evitar exposición de credenciales en cliente/logs.

### DEMO-18 — Validar Coraza y reglas de perímetro (opcional)

Issue publicado: [#18](https://github.com/TESSIUM-Tech/GroupMG-Commerce-Demo/issues/18).

**Milestone:** Posterior al demo\
**Etiquetas:** `demo`, `priority:P2`, `area:devops`, `area:security`, `type:task`\
**Dependencias:** DEMO-14.

**Objetivo:** activar el WAF previsto en el diagrama con evidencia de compatibilidad.

**Criterios de aceptación**

- [ ] Fijar versiones compatibles APISIX/Coraza/CRS y verificar el checksum del artefacto WASM.
- [ ] Validar primero detección y después bloqueo de casos controlados, registrando falsos positivos.
- [ ] Confirmar que checkout y webhook legítimos funcionan y el cuerpo firmado no se modifica.
- [ ] Definir límites por ruta y procedimiento de rollback de configuración; no cachear datos privados.

## Orden recomendado de inicio

Empezar por DEMO-01. Después avanzar DEMO-02 y DEMO-04 en paralelo si hay dos
personas disponibles. Continuar DEMO-03 → DEMO-05 → DEMO-06 para conseguir el
primer resultado visible. Desarrollar DEMO-07 y DEMO-08 en paralelo; el resto sigue
sus dependencias. Limitar el trabajo en curso a una tarea por persona.

El milestone inicial no incluye volver a crear el scaffold que ya existe.
Los issues de CI/runner o protección de main solo deben añadirse como pendientes
específicos si la revisión de GitHub confirma que siguen faltando.
