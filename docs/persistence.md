# DEMO-02 — Persistencia PostgreSQL

Prisma 7.10.0 y adaptador PostgreSQL en NestJS. Un PrismaClient por proceso; conexión
al iniciar y cierre con la app. La API ahora necesita DATABASE_URL y una base disponible.
Los endpoints comerciales se implementan en los siguientes issues.

## Base vacía y seed

Desde la raíz, Node 24 y pnpm según package.json:

```powershell
Copy-Item .env.example .env # Solo si todavía no existe; conservar configuración propia.
pnpm install --frozen-lockfile
docker compose up -d --wait postgres
pnpm run db:generate
pnpm run db:migrate
pnpm run db:seed
pnpm run db:status
```

DATABASE_URL apunta al host 127.0.0.1 para Node local. DATABASE_URL_DOCKER usa el host
postgres dentro de Compose. Ambas deben corresponder a usuario, contraseña y base de
POSTGRES_*. Codificar caracteres especiales de usuario/contraseña en las URLs.
.env no se versiona. Los valores de .env.example son solo de desarrollo.

La red data sigue siendo interna. PostgreSQL también pertenece a local-db para que
Docker publique 5432 en 127.0.0.1 y permita comandos Node locales; no se expone en 0.0.0.0.
Compose espera PostgreSQL saludable antes de iniciar la API. Readiness HTTP queda en #3.

Las migraciones se aplican explícitamente; iniciar la API no altera el esquema.
Para desarrollar cambios, crear una nueva migración Prisma, revisar SQL e incluir
constraints PostgreSQL que Prisma no expresa. No editar migraciones ya aplicadas.
No usar db push para sustituir las migraciones versionadas; no ejecutar migrate reset.

ALLOW_DEMO_SEED=true autoriza el catálogo ficticio de docs/demo-products.json.
El seed corre en transacción, serializa ejecuciones concurrentes y hace upsert por
SKU/categoría. Repetirlo conserva IDs y no crea duplicados; actualiza metadatos/precios
pero no restablece existencias, reservas ni versiones de inventario ya existentes.
No inserta clientes, identificaciones, pedidos ni pagos. No genera datos personales.
No crea tarifas de envío ficticias como si fueran tarifas comerciales acordadas.
ShippingRate queda listo para configurar zonas, importes, vigencia y versiones en #8.

## Esquema e invariantes

| Tabla              | Responsabilidad                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Category / Product | Categoría, SKU y referencia de proveedor únicos, precio base, IVA e imagen autorizada     |
| Inventory          | Un almacén demo-main; existencias y reservas no negativas, reservas <= existencias        |
| GuestCustomer      | Datos mínimos de contacto; no cuenta de autenticación                                     |
| Order / OrderItem  | Snapshot de cliente/facturación/envío y artículos, importes enteros y moneda explícita    |
| StockReservation   | Reserva única por pedido/producto, cantidad positiva y vencimiento                        |
| Payment            | Único clientTransactionId e identificador PayPhone por proveedor; moneda ligada al pedido |
| WebhookReceipt     | Clave de evento por proveedor, hash, recepción/verificación/procesamiento                 |
| OutboxEvent        | Evento único por pedido/tipo, JSON, intentos y publicación                                |
| ShippingRate       | Zona/version única, importe, moneda, IVA y vigencia                                       |

UUID generados por PostgreSQL; fechas timestamptz UTC. USD es la única moneda de la
demo. Importes Int en centavos (máximo 2.147.483.647); productos y cantidades positivos.
Las sumas y multiplicaciones de checks utilizan bigint para no desbordar durante
validación. CHECK en la migración protege precios, cantidades, inventario, hashes,
JSON de snapshots y totales, aun cuando se escribe por SQL fuera de Prisma.

OrderItem valida IVA por línea con redondeo mitad hacia arriba, y total = base + IVA.
Order valida total = subtotal + IVA artículos + envío base + IVA envío. La concordancia
con la suma de items y la tarifa se implementará transaccionalmente en #8.
Las relaciones de items y pagos incluyen moneda del pedido como FK compuesta.
FKs Restrict protegen referencias y snapshots contra borrados accidentales.

Estado permitido se guarda como ENUM PostgreSQL:

- Order: pending_payment, confirmed, canceled, expired, review_required.
- Payment: pending, approved, canceled, rejected, review_required. rejected se usa
  únicamente por el doble demo autorizado; no confundir cancelado con rechazo bancario.
- StockReservation: active, consumed, released.
- OutboxEvent: pending, published, failed.

La base rechaza estados desconocidos. El control de transiciones, creación/consumo
atómico de reservas, consistencia de importes con proveedor y confirmación + outbox
pertenecen a #8/#9; no quedan implementados por disponer del esquema.
Un pago approved requiere verificación e ID de proveedor. Un recibo procesado requiere
verificación; no guardar tokens, datos de tarjeta o payloads personales crudos.
Para PayPhone sin ID de evento, #9 debe definir eventKey a partir de ID de transacción
persistido + transición verificada; no usar el contenido arbitrario del callback como verdad.
Outbox publicado requiere publishedAt; las reentregas conservan el mismo eventId.

## Pruebas de integración aisladas

Crear una base separada una sola vez:

```powershell
docker compose exec -T postgres createdb -U commerce commerce_issue2_test
$env:DATABASE_URL = 'postgresql://commerce:local-change-me@127.0.0.1:5432/commerce_issue2_test?schema=public'
$env:ALLOW_DEMO_SEED = 'true'
$env:ALLOW_DB_TESTS = 'true'
pnpm run db:migrate
pnpm --filter @groupmg/api run build
pnpm run test:db
Remove-Item Env:DATABASE_URL, Env:ALLOW_DEMO_SEED, Env:ALLOW_DB_TESTS
```

Ajustar usuario/clave si se cambió .env. Las pruebas requieren explícitamente
commerce_issue2_test y ALLOW_DB_TESTS=true. Nunca apuntarlas a datos de producción.
Comprueban seed repetido, conservación de stock usado/reservado, restricciones,
relaciones, duplicados de recibos/outbox y conexión real de NestJS.
Los fixtures transaccionales se revierten; la modificación de inventario del test
se restaura en finally. La base test conserva el catálogo para poder repetir pruebas.
CI usa PostgreSQL aislado y ejecuta las mismas pruebas tras compilar.

## Persistencia tras reinicio

```powershell
pnpm run db:seed
docker compose restart postgres
docker compose up -d --wait postgres
pnpm run db:status
pnpm run db:seed
```

El volumen postgres-data conserva migraciones, IDs e inventario. Comparar conteos,
IDs y existencias antes/después; repetir seed no es una prueba suficiente por sí sola.
Detener con docker compose down conserva volúmenes. down -v destruye datos y no es
parte de este procedimiento. No se realizaron resets ni migraciones de producción.

## Evidencia local

Migración aplicada desde base vacía; seed repetido sin duplicados y con stock usado/reservado conservado.
Seis pruebas de integración PostgreSQL/NestJS aprobadas. Huella de IDs, SKU, referencias,
precios, moneda y stock idéntica antes/después del reinicio y después de repetir el seed:

b695ea47461b0f857a229b656683128e

Typecheck, formato, build del monorepo y validación Compose verificados localmente.
No se ejecutó CI remota ni se modificó GitHub.

Imagen Docker de API compilada; liveness HTTP 200 y consulta Prisma de 12 productos verificados dentro del contenedor.
