FROM node:22-bookworm-slim

# Supplied by the trusted CI/deploy runner, never derived from a worker response.
ARG AI_CORE_BUILD_SHA=unknown
LABEL org.opencontainers.image.revision=$AI_CORE_BUILD_SHA

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

ENV HOSTINGER_FRONTEND=ai-platform
# The Vite builds require an explicit production base path and port at build time.
ENV NODE_ENV=production
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm run build:workspace

ENV NODE_ENV=development
ENV APP_ENV=development
ENV SERVE_FRONTEND=true
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 CMD node -e "fetch('http://127.0.0.1:8080/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
