# Etapas posteriores al init

1. **Persistencia y catálogo:** acordar contrato ERP, ORM y migraciones; importar
   fixtures controlados y exponer catálogo con paginación. Aceptación: SKU único,
   validación de entradas y disponibilidad consistente con la proyección local.
2. **Identidad y pedidos:** elegir identidad/sesión, definir carrito, precios y
   reservas. Aceptación: permisos por recurso y cálculo de totales exclusivamente servidor.
3. **Pagos:** seleccionar proveedor, iniciar checkout y verificar webhooks.
   Aceptación: firmas inválidas rechazadas, eventos duplicados sin doble cobro/pedido
   y confirmación transaccional con outbox.
4. **RabbitMQ y ERP:** declarar colas, consumidor, reintentos, DLQ y reconciliación.
   Aceptación: una caída del ERP no pierde ventas y la reentrega no duplica registros.
5. **Perímetro y operación:** TLS, Coraza/CRS, rate limiting, caché de catálogo,
   logs/métricas, backups y readiness. Aceptación: pruebas WAF reales, restauración
   ensayada y políticas de caché sin información privada.
6. **Interfaz comercial:** diseño de catálogo/ficha/carrito/checkout con datos reales,
   estados de carga/error y accesibilidad. Aceptación: recorrido de compra probado
   y medición de los presupuestos documentados.

Pendiente de decisión: proveedor ERP y contrato, Stripe/PayPal, reservas de stock,
impuestos/envío/monedas, identidad, ORM, hosting y responsable de accesibilidad.
