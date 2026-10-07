FROM node:22-bookworm-slim AS build

WORKDIR /workspace
ENV CI=true
ARG GITHUB_SHA=unknown
ENV GITHUB_SHA=$GITHUB_SHA \
    APP_ENV=development \
    NODE_ENV=development \
    PORT=3000 \
    BASE_PATH=/ \
    HOSTINGER_FRONTEND=ai-platform

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV APP_ENV=development \
    NODE_ENV=development \
    PORT=3000 \
    SERVE_STATIC_FRONTEND=true \
    AI_DISPATCHER_ENABLED=false \
    AI_SCHEDULER_ENABLED=false \
    AI_INCIDENT_WATCHER_ENABLED=false \
    AI_PROVIDER_BILLING_MONITOR_ENABLED=false \
    OLLAMA_WORKER_RUNTIME_ENABLED=false \
    GCP_OLLAMA_AUTOSTART_ENABLED=false \
    GCP_OLLAMA_REMOTE_AUTOSTOP_ENABLED=false \
    GCP_CODING_WORKER_AUTOSTART_ENABLED=false \
    ZEROLLM_ENABLED=false \
    ZEROLLM_REQUIRED=false

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
COPY --from=build /workspace /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/hostinger-start.cjs"]
