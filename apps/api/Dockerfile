# syntax=docker/dockerfile:1
# Build-Kontext: Projektwurzel  →  docker build -f apps/api/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @chfree/api

# Laufzeit-Image: alle Abhängigkeiten sind in dist/ gebündelt – keine node_modules nötig
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown app:app /app/data
# Beschreibbarer Ordner (z. B. Zustand des Pterodactyl-Mock-Modus) – in docker-compose als Volume
ENV PTERODACTYL_MOCK_STATE_FILE=/app/data/pterodactyl-mock.json
COPY --from=build --chown=app:app /app/apps/api/dist ./dist
COPY --from=build --chown=app:app /app/apps/api/drizzle ./drizzle
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
# Standard: API. Für den Worker:   command: ["node", "dist/worker.js"]
#              Für Migrationen:     command: ["node", "dist/migrate.js"]
CMD ["node", "dist/index.js"]
