# Arquitectura inicial

Estado: propuesta de base, derivada del diagrama de referencia. El código inicial
incluye arranque, liveness, vistas iniciales y contratos; DEMO-02 añade conexión de la API a PostgreSQL, migraciones y seed.

## Responsabilidades y límites

| Componente | Responsabilidad                                       | Estado del init                          |
| ---------- | ----------------------------------------------------- | ---------------------------------------- |
| Next.js    | Renderizado del catálogo y experiencia de checkout    | Tres vistas iniciales                    |
| NestJS API | Catálogo, identidad, pedidos y coordinación de pagos  | Módulos, liveness y Prisma               |
| Worker ERP | Adaptar el ERP, importar inventario y exportar ventas | Arranque y puerto tipado                 |
| PostgreSQL | Estado transaccional de comercio                      | Esquema versionado y seed                |
| Redis      | Caché y sesiones con TTL                              | Contenedor, sin clientes                 |
| RabbitMQ   | Entrega asíncrona de eventos                          | Contenedor, sin topología                |
| APISIX     | Entrada HTTP y enrutamiento                           | Configuración standalone                 |
| Coraza     | Inspección WAF con OWASP CRS                          | Pendiente de artefacto WASM y validación |

Monorepo con pnpm workspaces y TypeScript. La API es un monolito modular;
el worker tiene ciclo de vida independiente por la naturaleza de sus reintentos
y dependencias externas. No se crea un microservicio por cada entidad.

## Flujo objetivo

1. El cliente entra por APISIX. Coraza inspeccionará las solicitudes cuando esté habilitado.
2. APISIX dirige la web a Next.js y `/api/*` a NestJS. La web SSR podrá consultar
   la API internamente; el navegador utilizará rutas relativas del gateway.
3. NestJS calcula precios e inventario y crea el pedido pendiente. Nunca confía
   en totales o estados de pago enviados por el navegador.
4. NestJS crea la solicitud PayPhone API Sale. El cliente paga en PayPhone Personal.
5. PayPhone notifica identificadores a través de APISIX. NestJS consulta el estado
   con autenticación, valida IDs/importe/moneda, deduplica y confirma el pedido.
6. La misma transacción de PostgreSQL guarda el cambio de pedido y un evento outbox.
7. Un publicador confirma la entrega a RabbitMQ y marca el outbox. El worker
   registra la venta en el ERP y procesa mensajes de forma idempotente.
8. Una tarea del worker importa inventario paginado con checkpoint; actualiza
   la proyección local e invalida cachés según una política definida.

Decisión respecto de la imagen: pagos y webhooks pertenecen al backend. Evita
repartir entre Next.js y NestJS las reglas de confirmación. PayPhone API Sale es
la única pasarela elegida. Reglas y límites: [DEMO-01](demo-rules.md).

## Organización de código al implementar cada módulo

Dentro de `apps/api/src/modules/<dominio>` se añadirán:

- `domain/`: entidades, invariantes y puertos; sin imports de infraestructura.
- `application/`: casos de uso y límites transaccionales.
- `infrastructure/`: repositorios, caché y adaptadores externos.
- `presentation/`: controladores HTTP y DTO validados.

Las carpetas se crean al tener implementación, para evitar directorios vacíos.
Los módulos no importan repositorios privados de otros módulos. Comparten puertos
exportados explícitamente. `packages/contracts` contiene contratos de transporte,
no entidades del ORM ni secretos. Se añadirá validación de runtime en los bordes;
las interfaces TypeScript por sí solas no validan mensajes externos.

El worker utilizará `ports/erp.port.ts` y adaptadores específicos del proveedor.
Los códigos, formatos de fechas y errores del ERP se traducen en ese límite.

## Datos y persistencia

| Entidad                  | Claves e invariantes previstas                                                 |
| ------------------------ | ------------------------------------------------------------------------------ |
| Product / Category       | ID interno, SKU único, referencia ERP y estado de publicación                  |
| Inventory                | SKU + almacén únicos, disponible, versión del origen y fecha de sincronización |
| Customer                 | Identidad externa o credencial protegida según el mecanismo elegido            |
| Order / OrderItem        | Estado, moneda, totales y snapshot de SKU/precio/cantidad                      |
| Payment / WebhookReceipt | ID de proveedor único, ID de evento único y estado verificado                  |
| OutboxEvent              | eventId único, payload versionado, intentos y fecha de publicación             |
| InboxReceipt / ErpSync   | eventId único, referencia ERP, intentos y checkpoint                           |

Importes en unidades monetarias menores, moneda explícita y cantidades positivas.
La precisión monetaria depende de la moneda. Fechas UTC, IDs opacos y constraints
en base de datos. Prisma y migraciones implementados: [Persistencia](persistence.md).

ERP es fuente de catálogo/inventario según contrato a confirmar; PostgreSQL es
fuente del pedido y pago local. El worker deberá escribir proyecciones mediante
un contrato interno limitado, sin modificar directamente pedidos/pagos.

## Mensajería y fallos

Evento inicial: `order.confirmed.v1`. Propuesta de exchange durable
`commerce.events` (topic), cola `erp.sales.v1`, routing key `order.confirmed.v1`,
cola de reintentos con TTL y cola de errores `erp.sales.dlq`.
La topología todavía no está declarada en RabbitMQ.

Garantía prevista: al menos una entrega, nunca exactamente una. Publisher confirms,
ack manual después de persistir, deduplicación por eventId, backoff con límite de
intentos y revisión de la DLQ. Timeouts y circuit breaker para el ERP. Si el ERP
no soporta claves idempotentes, reconciliar por referencia del pedido antes de
reenviar tras un timeout. El pago confirmado no se revierte por una caída del ERP.

## Redes, seguridad y operación

`edge` conecta gateway/web/API; `data` es interna y conecta API/worker/datos;
`integration` permite salida del worker hacia el ERP. La API dispone de salida
para el proveedor de pagos. Solo se publica gateway en loopback; los puertos de
datos también se exponen en loopback para desarrollo. Eliminar esos mapeos en producción.

Compose describe un entorno local en un host; no un clúster de alta disponibilidad.
Producción requiere TLS, secretos gestionados, backups/restauración comprobados,
readiness de dependencias, políticas de red y recursos, observabilidad y WAF validado.
No está incluida una configuración de producción ni Kubernetes.

Autenticación, autorización, CSRF según estrategia de sesiones, validación de DTO,
límites por ruta y claves idempotentes quedan pendientes. No cachear checkout,
webhooks ni respuestas personalizadas. La caché de catálogo requiere claves,
TTL e invalidación definidos antes de habilitarla en APISIX/Redis.

Logs estructurados con correlationId y eventId, sin datos de tarjeta, tokens ni
payloads sensibles. Métricas futuras: latencia, errores, antigüedad de outbox,
profundidad de colas, DLQ y retraso de inventario.

## Base visual y objetivos

Sistema inicial: fondo neutro, tipografía del sistema, tarjetas y estados vacíos,
componentes de servidor por defecto. Catálogo público dependiente de SEO;
checkout no debe indexarse cuando contenga información de compra.

Supuestos: móvil/4G, WCAG 2.2 AA, responsable de accesibilidad pendiente de asignar
por el equipo. Metas p75: LCP ≤ 2000 ms, INP ≤ 200 ms, CLS ≤ 0.1; presupuesto de
JS por ruta ≤ 150 KB gzip; Lighthouse móvil performance ≥ 90 y accesibilidad ≥ 95.
Son objetivos para la implementación, no mediciones ni gates activos del init.

## Referencias

- [APISIX standalone](https://apisix.apache.org/docs/apisix/deployment-modes/)
- [Integración Coraza y OWASP CRS](https://apisix.apache.org/blog/2024/02/13/apisix-owasp-coraza-core-ruleset/)
