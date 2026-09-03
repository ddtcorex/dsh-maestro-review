# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/dsh-maestro-review/package.json packages/dsh-maestro-review/
COPY maestro-skills/package.json maestro-skills/
RUN pnpm install --frozen-lockfile --filter @ddtcorex/dsh-maestro-review...
COPY packages/dsh-maestro-review packages/dsh-maestro-review
COPY maestro-skills maestro-skills
RUN pnpm --filter @ddtcorex/dsh-maestro-review build
FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/packages/dsh-maestro-review/lib ./lib
COPY --from=builder /build/node_modules ./node_modules
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
LABEL org.opencontainers.image.source="https://github.com/ddtcorex/maestro-harness"
ENTRYPOINT ["/usr/bin/tini","--","/entrypoint.sh"]
CMD ["review"]
