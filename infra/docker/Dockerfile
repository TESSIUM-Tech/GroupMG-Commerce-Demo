FROM node:24-bookworm-slim AS base
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker-erp/package.json apps/worker-erp/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN corepack prepare pnpm@12.5.1 --activate

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
ARG WORKSPACE
RUN pnpm --filter=${WORKSPACE} run build
ENV CI=true
RUN pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG WORKSPACE
ENV APP_WORKSPACE=${WORKSPACE}
COPY --from=build --chown=node:node /workspace /workspace
USER node
# El runtime usa Node directamente; no necesita descargar el gestor de paquetes.
CMD ["sh", "-c", "cd apps/${APP_WORKSPACE#@groupmg/} && if [ \"$APP_WORKSPACE\" = '@groupmg/web' ]; then exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000; else exec node dist/main.js; fi"]
