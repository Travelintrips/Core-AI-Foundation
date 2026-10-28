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
RUN pnpm run build:workspace

ENV NODE_ENV=development
ENV APP_ENV=development
ENV SERVE_FRONTEND=true
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
