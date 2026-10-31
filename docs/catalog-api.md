# API de catálogo e inventario disponible

Consulta pública de productos persistidos en PostgreSQL. Los productos del seed
son ficticios de la demo. Solo se devuelven productos publicados, incluidos los
agotados. No se escriben reservas ni inventario desde estos endpoints.

## Endpoints

- `GET /api/v1/products`: listado paginado.
- `GET /api/v1/products/:id`: detalle por UUID persistido del producto.

Ejemplo: `/api/v1/products?page=1&limit=20&q=celular&category=celulares`.

| Parámetro | Regla                                                                                 |
| --------- | ------------------------------------------------------------------------------------- |
| page      | Entero decimal de 1 a 2147483647; predeterminado 1                                    |
| limit     | Entero decimal de 1 a 100; predeterminado 20                                          |
| q         | Texto de 1 a 100 caracteres después de recortar espacios; opcional                    |
| category  | Slug de hasta 100 caracteres, minúsculas, dígitos y guiones entre segmentos; opcional |

La búsqueda usa coincidencia parcial por nombre o SKU, sin distinguir mayúsculas.
No ofrece búsqueda avanzada ni normalización de acentos. Búsqueda y categoría se
combinan con AND. Los parámetros desconocidos, repetidos o inválidos se rechazan
con 400. El orden es nombre ascendente y UUID ascendente para resolver empates.
La paginación por offset no garantiza estabilidad entre solicitudes si cambia el
catálogo; cada listado obtiene total y productos en la misma instantánea.

El listado devuelve `items`, `pagination` (`page`, `limit`, `total`, `totalPages`)
y `correlationId`. El detalle devuelve `product` y `correlationId`.

Cada producto contiene `id`, `sku`, `name`, `category` (`slug`, `name`),
`priceMinor`, `currency`, `taxRateBps`, `imageUrl`, `availableQuantity` e `inStock`.
Precio en centavos, antes de IVA. Las imágenes relativas apuntan a recursos de la
web. No se exponen registros Prisma, referencias ERP ni contadores internos.

Disponible = max(0, Inventory.onHand - Inventory.reserved). Sin inventario,
disponible = 0. `reserved` es el contador persistido de reservas activas; esta
lectura no expira ni libera reservas. El futuro flujo de pedidos deberá mantenerlo
en transacción y revalidar stock antes de reservar.

Una colección sin coincidencias devuelve 200 con items vacíos, total 0 y
totalPages 0. Una página fuera del total devuelve 200 con items vacíos y conserva
el total. UUID inválido devuelve 400; producto inexistente o no publicado devuelve 404. Los errores mantienen el filtro HTTP global y correlationId.

## Arquitectura y validación

El dominio define tipos, disponibilidad y puerto del repositorio. Los casos de uso
dependen del puerto y no importan NestJS ni Prisma. La presentación valida HTTP y
traduce ausencias a 404. El adaptador Prisma aplica filtros de publicación, mapea
campos públicos y consulta PostgreSQL. NestJS conecta las capas mediante factories.
No se agregan migraciones, caché, CQRS ni repositorios genéricos.

Tras compilar (`pnpm --filter @groupmg/api build`):

- `pnpm --filter @groupmg/api test:catalog:unit`: pruebas sin base de datos.
- `pnpm --filter @groupmg/api test:catalog`: HTTP con PostgreSQL real.
- `pnpm test`: suite completa, ejecutada secuencialmente para que los fixtures de
  catálogo no interfieran con las comprobaciones existentes del seed.

Las pruebas de integración requieren `ALLOW_DB_TESTS=true`, `DATABASE_URL` hacia
`commerce_issue2_test` y migraciones aplicadas. Los fixtures se crean en categorías
únicas y se eliminan al terminar. No usar la base de demo o producción.

Cobertura: búsqueda, categoría y su combinación, orden con empates, paginación,
campos públicos, descuento de reservas, agotados, ausencia de inventario, ocultos,
404, colección vacía, páginas fuera de resultados y filtros inválidos.

Fuera de alcance: búsqueda avanzada, caché perimetral, checkout, creación de
reservas y sincronización ERP.
