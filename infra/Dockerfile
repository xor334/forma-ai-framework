FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
COPY apps/web/package.json apps/web/
COPY apps/studio/package.json apps/studio/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-fund --no-audit --fetch-retries=2 --fetch-timeout=35000
COPY . .
RUN find apps packages services business infra/migrations -type f ! -path '*/node_modules/*' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1 > .source-hash
RUN cat .source-hash package-lock.json | sha256sum | cut -d' ' -f1 > .forma-image
RUN npm run typecheck && npm run build && npm prune --omit=dev --ignore-scripts --offline --no-audit
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
ARG FORMA_BUILD_COMMIT=local
ENV FORMA_COMMIT=$FORMA_BUILD_COMMIT
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 FORMA_ROOT=/app
COPY --from=build --chown=node:node /app /app
USER node
CMD ["npm","run","start","-w","@forma/web"]
