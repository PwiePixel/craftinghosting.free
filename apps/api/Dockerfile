# syntax=docker/dockerfile:1
# Build-Kontext: Projektwurzel  →  docker build -f apps/api/Dockerfile .
# Debian-Basis (glibc): Die verschlüsselte SQLite-Datenbank nutzt das native Modul libSQL.

FROM node:22-bookworm-slim AS build
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

# Laufzeit-Abhängigkeiten der API (ohne Dev-Pakete) – gebraucht wird daraus zur Laufzeit nur libSQL,
# alles andere ist in dist/ gebündelt.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @chfree/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# /data: verschlüsselte Datenbank (und Zustand des Mock-Modus) – in docker-compose ein Volume, das API und Worker teilen
RUN groupadd --system app && useradd --system --gid app --home-dir /app app && mkdir -p /data && chown app:app /data
ENV DATABASE_PATH=/data/chfree.db \
    PTERODACTYL_MOCK_STATE_FILE=/data/pterodactyl-mock.json
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/apps/api/dist ./dist
COPY --from=build --chown=app:app /app/apps/api/drizzle ./drizzle
# Wissensdatei des Support-Chats (Crafting AI)
COPY --from=build --chown=app:app /app/apps/api/knowledge ./knowledge
USER app
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Standard: API. Für den Worker:   command: ["node", "dist/worker.js"]
#              Für Migrationen:     command: ["node", "dist/migrate.js"]
CMD ["node", "dist/index.js"]
