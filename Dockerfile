# Prototyper server: panel, MCP API, client review links and HTTPS certificates, in one image.
#   docker build -t prototyper .
# See docs/self-hosting.md.

FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/panel/package.json apps/panel/
COPY packages/overlay/package.json packages/overlay/
COPY packages/shared/package.json packages/shared/
COPY packages/mcp/package.json packages/mcp/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/panel apps/panel
COPY packages/overlay packages/overlay
COPY packages/shared packages/shared
RUN pnpm --filter @prototyper/overlay build \
 && pnpm --filter @prototyper/panel build \
 && pnpm --filter @prototyper/server build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    DATA_DIR=/data \
    CERTS_DIR=/certs \
    HOST=0.0.0.0 \
    STANDALONE=true \
    HTTP_PORT=8080 \
    HTTPS_PORT=8443 \
    PORT=3700
WORKDIR /app
COPY --from=build /src/apps/server/dist/package.json ./
# sharp, and a headless Chromium (with its system libraries) for the project thumbnails.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && npm install --omit=dev --no-audit --no-fund --loglevel=error \
 && npx --no-install playwright-core install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*
COPY --from=build /src/apps/server/dist/ ./
COPY deploy/docker/prototyper /usr/local/bin/prototyper
COPY deploy/docker/healthcheck.mjs ./
RUN mkdir -p /data /certs && chown node:node /data /certs && chmod 700 /data
USER node
VOLUME ["/data", "/certs"]
EXPOSE 8080 8443 3700
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "/app/healthcheck.mjs"]
CMD ["prototyper"]
