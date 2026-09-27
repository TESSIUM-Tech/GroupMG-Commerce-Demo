# Desarrollo local

Usar Node 24. Ejecutar los comandos desde la raíz. `pnpm install --frozen-lockfile` instala el lockfile
compartido. Las variables de Compose se leen de `.env`; las aplicaciones Node
solo usan `PORT` por ahora. No hay credenciales de proveedores que configurar.

## Aplicaciones

`pnpm run dev:web` inicia Next.js con recarga. `pnpm run build` compila todo.
API: `pnpm --filter @groupmg/api start`. Worker:
`pnpm --filter @groupmg/worker-erp start`.

En desarrollo backend, `pnpm run dev:api` o `pnpm run dev:worker` recompilan con
watch; en otra terminal usar `node --watch apps/api/dist/main.js` o
`node --watch apps/worker-erp/dist/main.js` después del primer build.
El worker permanece vivo sin consumir mensajes, hacer cron ni llamar al ERP.

Health web: `/health`. Health API: `/api/v1/health`. Ambos son liveness;
un 200 no certifica conexión con PostgreSQL, Redis, RabbitMQ o proveedores.
No hay rutas de pedidos/pagos que simulen éxito.

## Contenedores

Copiar `.env.example` a `.env`. `pnpm run infra:up` levanta solo datos/broker.
`docker compose --profile app up --build -d` agrega aplicaciones y APISIX.
Abrir `http://localhost:8080`, `/catalogo`, `/checkout`, `/api/v1/health`.
RabbitMQ Management: `http://localhost:15672` con las credenciales del `.env`.

Inspección: `docker compose --profile app ps` y `docker compose logs <servicio>`.
Detener: `docker compose --profile app down`; conserva volúmenes.
Cambiar las variables de contraseña no rota credenciales de volúmenes ya creados.

Las imágenes usan tags de versión, no digest; fijar digest cuando se valide la
plataforma de despliegue. No hay dependencia de arranque entre apps y datos porque
el scaffold todavía no conecta clientes. Añadir readiness/reintentos al integrarlos.

## Revisión del init

La CI instala desde lockfile, revisa formato, tipos, compilación y sintaxis Compose.
No demuestra tráfico completo de Docker ni seguridad de la integración WAF.
Las pruebas de dominio se incorporarán con casos de uso; las de integración deben
cubrir webhooks duplicados, fallos ERP, reentrega y consistencia del outbox.
