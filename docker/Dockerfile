# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /build
COPY maestro-workspace ./maestro-workspace
COPY packages/dsh-maestro-review/package.json packages/dsh-maestro-review/
COPY packages/dsh-maestro-config-lib/package.json packages/dsh-maestro-config-lib/
COPY maestro-skills/package.json maestro-skills/
RUN pnpm --dir maestro-workspace install --frozen-lockfile
COPY packages/dsh-maestro-review packages/dsh-maestro-review
COPY packages/dsh-maestro-config-lib packages/dsh-maestro-config-lib
COPY maestro-skills maestro-skills
RUN pnpm --dir maestro-workspace --filter @ddtcorex/dsh-maestro-review build
FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/packages/dsh-maestro-review/lib ./lib
COPY --from=builder /build/maestro-workspace/node_modules ./node_modules
COPY --from=builder /build/maestro-skills ./maestro-skills
COPY packages/dsh-maestro-review/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
LABEL org.opencontainers.image.source="https://github.com/ddtcorex/maestro-harness"
ENTRYPOINT ["/usr/bin/tini","--","/entrypoint.sh"]
CMD ["review"]
