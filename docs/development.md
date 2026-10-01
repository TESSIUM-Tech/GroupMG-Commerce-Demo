# Desarrollo local

Usar Node 24. Ejecutar los comandos desde la raíz. `pnpm install --frozen-lockfile` instala el lockfile
compartido. Las variables de Compose se leen de `.env`; las aplicaciones Node
usan `PORT`; la API requiere `DATABASE_URL` y PostgreSQL disponible. PayPhone sigue pendiente de implementación.

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
plataforma de despliegue. La API espera PostgreSQL saludable y conecta al iniciar; los demás clientes siguen pendientes. Readiness HTTP se implementa en #3.

## Revisión del init

La CI instala desde lockfile, revisa formato, tipos, compilación, sintaxis Compose y persistencia PostgreSQL.
No demuestra tráfico completo de Docker ni seguridad de la integración WAF.
Las pruebas de dominio se incorporarán con casos de uso; las de integración deben
cubrir webhooks duplicados, fallos ERP, reentrega y consistencia del outbox.

## Persistencia

Antes de arrancar la API, aplicar migraciones y seed según [DEMO-02](persistence.md).
No se ejecutan migraciones automáticamente al iniciar. Las credenciales PayPhone no son necesarias para #2.
