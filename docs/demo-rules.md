# DEMO-01 — Reglas y datos de la demo

Decisiones acordadas el 30 de septiembre de 2026 (America/Guayaquil).
Implementación pendiente: este documento define el contrato para #2, #4, #8 y #9.

## Moneda, impuestos y entrega

- Moneda única: USD. Importes enteros en centavos; no usar floats para dinero.
- Precios del catálogo demo antes de IVA. Mostrar base, IVA, envío y total antes de pagar.
- IVA configurable por producto y guardado como snapshot en cada item del pedido.
  Los productos tecnológicos ficticios de este catálogo usan la tarifa general del 15 %.
  Aplicar la clasificación tributaria vigente; no extender esa tarifa a todos los bienes.
- Calcular IVA por línea con redondeo al centavo, mitad hacia arriba; sumar las líneas.
- Retiro en local: tarifa de entrega cero.
- Repartidor: tarifa dinámica configurable por zona, en centavos USD, con versión,
  vigencia y tasa de IVA propia. Una zona sin tarifa vigente no permite confirmar checkout.
  El servidor elige la tarifa; el navegador no envía un importe de envío autoritativo.
- Guardar zona, versión, base e impuesto de envío en el pedido. Cambios posteriores
  no alteran pedidos existentes. Revalidar y mostrar cambios antes de iniciar el pago.
- Los datos de facturación se recopilan, pero la emisión de factura fiscal/SRI
  permanece fuera del demo. El comprobante demo debe identificarse como no fiscal.

Referencia: [SRI, IVA](https://www.sri.gob.ec/impuesto-al-valor-agregado-iva).
La configuración y clasificación tributaria deben revisarse al desplegar.

## Stock y pedido

- Un almacén. Disponible = existencias menos reservas activas.
- Vender hasta agotar; mostrar agotados sin permitir comprarlos. Sin preventa ni negativos.
- Cantidades enteras positivas. Crear pedido y reservar en una transacción con
  control de concurrencia; dos compradores del último artículo no pueden reservarlo.
- Reserva de cinco minutos, alineada con la ventana documentada de API Sale.
- Pago aprobado y verificado: consumir la reserva una sola vez y confirmar el pedido.
- Pago cancelado, rechazo simulado o expiración: liberar la reserva una sola vez.
- Timeout de comunicación no equivale a rechazo: conservar pago pendiente y reconciliar.
- Pago aprobado después de liberar stock: revisar disponibilidad en transacción;
  si no alcanza, marcar revisión requerida, no confirmar ni exportar al ERP.
- Estados de pedido: pending_payment, confirmed, canceled, expired, review_required.
  Pago: pending, approved, canceled, rejected (doble demo), review_required.
  Confirmación y outbox deben persistirse atómicamente; eventos repetidos no duplican ventas.

## ORM

Prisma con PostgreSQL para la API NestJS. Migraciones versionadas y seed idempotente
implementados en DEMO-02. Prisma y adaptador PostgreSQL fijados en 7.10.0.
El dominio utiliza puertos; no expone modelos Prisma al frontend ni al worker.

Referencia: [Prisma con NestJS](https://docs.prisma.io/docs/guides/frameworks/nestjs).

## Compra invitada y datos mínimos

- Sin registro en la tienda: nombres, apellidos, correo y teléfono.
- API Sale requiere teléfono registrado en PayPhone Personal y código de país 593.
  La compra invitada en la tienda no elimina ese requisito del proveedor.
- Envío: provincia, ciudad, zona, dirección y referencia; no pedir dirección de
  entrega para retiro. Dirección de facturación independiente.
- Facturación: tipo de identificación (cédula, RUC o pasaporte), identificación,
  nombre completo o razón social, dirección y correo. Validar en backend.
- Guardar snapshot del cliente/facturación del pedido. Datos ficticios en seed.
- Consulta privada con token aleatorio de al menos 32 bytes, hash guardado en base
  y vencimiento configurable (valor demo: 24 horas). ID del pedido no autoriza acceso.
- Sin tokens ni datos personales en logs, URLs públicas indexables o caché compartida.
  Entregar el token por un canal privado y enviarlo al API en Authorization.

## PayPhone API Sale: única pasarela

El usuario confirma que ya creó la configuración de PayPhone. Las credenciales,
el modo pruebas y una transacción exitosa aún no se han verificado desde la app.
No integrar Stripe ni una segunda pasarela.

- Aplicación tipo API, ambiente PRUEBAS, Token y StoreID solo en backend.
  Confirmar en PayPhone Developers que la aplicación está en pruebas antes del smoke.
  Usar probador de PayPhone Personal para validar el recorrido en su app.
- POST https://pay.payphonetodoesposible.com/api/Sale crea la solicitud.
  El cliente recibe la notificación y paga dentro de PayPhone Personal.
- Persistir clientTransactionId único por intento y transactionId recibido.
  Un timeout al crear exige consultar por clientTransactionId antes de reintentar.
- GET /api/Sale/{transactionId} o /api/Sale/client/{clientTransactionId}, con Bearer
  del servidor, verifica resultado. statusCode 3 = aprobado; 2 = cancelado.
  Una cancelación no debe etiquetarse como rechazo bancario.
- La URL base es compartida: la selección de pruebas pertenece a la configuración
  del proveedor; una variable local por sí sola no convierte una cuenta real en sandbox.
- Montos en centavos: amount = amountWithoutTax + amountWithTax + tax + service + tip.
  amountWithTax es la base gravada antes del impuesto. La clasificación del envío
  debe conciliarse con el desglose y con el total; no duplicarlo en service.
  Propina y recargos adicionales: cero para esta demo.
- responseUrl recibe id y clientTransactionID. Los documentos aportados no describen
  firma: tratar la notificación como disparador no confiable, nunca como prueba de pago.
  Consultar al proveedor y comparar IDs persistidos, importe y moneda antes de confirmar.
  Deduplicar recepción y transición; aplicar rate limit al callback.
- Consultas centralizadas con presupuesto global máximo de 30/minuto para el endpoint
  de estado documentado; backoff y reconciliación posterior ante 429 o caída de red.
- PayPhone documenta aprobación de todas las transacciones en PRUEBAS. El escenario
  de rechazo será un doble determinista del mismo puerto de pagos, autorizado por el
  usuario y habilitado solo en demo/tests. Mostrar “rechazo simulado”; no presentarlo
  como evidencia de rechazo real del proveedor. No activarlo desde parámetros públicos.
- El smoke real solo prueba aprobación/cancelación según lo observado, sin cobros reales.

Fuentes aportadas: API Sale y Configuración de ambiente y credenciales de PayPhone.
Referencia pública: [API Sale](https://docs.payphone.app/api-sale).

## Catálogo ficticio reproducible

Propuesta inicial de productos tecnológicos para el demo. Precios base en USD antes
de IVA; el JSON guarda centavos y taxRateBps (1500 = 15 %).

| SKU         | Producto                   | Categoría   | Precio base USD | Stock |
| ----------- | -------------------------- | ----------- | --------------: | ----: |
| MG-DEMO-001 | Celular Nova X1 128 GB     | celulares   |          199.00 |    20 |
| MG-DEMO-002 | Celular Nova X2 256 GB     | celulares   |          299.00 |    15 |
| MG-DEMO-003 | Celular Orbit Lite 64 GB   | celulares   |          129.00 |    30 |
| MG-DEMO-004 | Funda universal Flex       | accesorios  |            8.50 |    50 |
| MG-DEMO-005 | Cargador USB-C 25 W        | accesorios  |           15.00 |    12 |
| MG-DEMO-006 | Cable USB-C 1 m            | accesorios  |            5.90 |    18 |
| MG-DEMO-007 | Audífonos Bluetooth Pulse  | audio       |           24.90 |     8 |
| MG-DEMO-008 | Parlante Bluetooth Beat    | audio       |           35.90 |    10 |
| MG-DEMO-009 | Mouse inalámbrico Click    | computacion |           12.90 |     7 |
| MG-DEMO-010 | Teclado compacto Key       | computacion |           22.90 |     6 |
| MG-DEMO-011 | Soporte para portátil Lift | computacion |           19.90 |     1 |
| MG-DEMO-012 | Power bank 10000 mAh Volt  | accesorios  |           25.90 |     0 |

Datos para DEMO-02: demo-products.json. Cada producto tiene referencia de proveedor
ficticia única y una imagen /demo/products/MG-DEMO-NNN.svg. Ilustraciones SVG
originales creadas para este repositorio, sin fotografías ni marcas de terceros;
autorizadas para uso y modificación en esta demo. No representan productos reales.

## Guion y evidencia esperada

1. Compra exitosa: comprar MG-DEMO-001, escoger retiro o una zona con tarifa,
   ingresar datos de prueba y aprobar en PayPhone Personal. Verificar total,
   estado confirmado, descuento único de stock y una exportación al ERP simulado.
2. Pago rechazado: activar el doble demo de rechazo, crear pedido y mostrar
   “rechazo simulado”. Verificar liberación de reserva, carrito recuperable y cero ventas ERP.
3. Falta de stock: MG-DEMO-012 aparece agotado; intentar comprarlo se rechaza en
   servidor. Dos compras concurrentes de MG-DEMO-011: solo una obtiene reserva.
4. ERP caído: confirmar un pago con ERP simulado en fallo temporal. Pedido sigue
   confirmado; outbox conserva la venta. Recuperar ERP y verificar una sola venta.

## Registro del issue 1

Avance: reglas documentadas, Prisma elegido, PayPhone API Sale elegido con cuenta
reportada como creada, catálogo ficticio y guion definidos. No se ejecutaron pagos.
Pendientes: verificar ambiente PRUEBAS y smoke; implementar datos (#2), pedidos (#8),
pagos (#9) y ERP simulado. DEMO-09 exige firma de webhook en el backlog original:
revisar ese criterio para admitir consulta autenticada al proveedor; no afirmar que
API Sale ofrece una firma sin documentación. Este cambio de criterio no se ha publicado.
El issue no se cierra ni se modifica en GitHub desde este trabajo local.
