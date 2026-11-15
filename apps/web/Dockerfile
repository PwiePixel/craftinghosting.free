# syntax=docker/dockerfile:1
# Build-Kontext: Projektwurzel  →  docker build -f apps/web/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Öffentliche (nicht geheime) Werte werden beim Build eingebettet
ARG NEXT_PUBLIC_SITE_URL=https://craftinghosting.free
ARG NEXT_PUBLIC_PARENT_URL=https://crafting.host
ARG NEXT_PUBLIC_PARENT_PRICING_URL=https://crafting.host/pricing
ARG NEXT_PUBLIC_DISCORD_URL=
ARG NEXT_PUBLIC_STATUS_URL=
ARG NEXT_PUBLIC_PANEL_URL=https://panel.craftinghosting.free
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_PARENT_URL=$NEXT_PUBLIC_PARENT_URL \
    NEXT_PUBLIC_PARENT_PRICING_URL=$NEXT_PUBLIC_PARENT_PRICING_URL \
    NEXT_PUBLIC_DISCORD_URL=$NEXT_PUBLIC_DISCORD_URL \
    NEXT_PUBLIC_STATUS_URL=$NEXT_PUBLIC_STATUS_URL \
    NEXT_PUBLIC_PANEL_URL=$NEXT_PUBLIC_PANEL_URL \
    API_INTERNAL_URL=http://api:4000
RUN npm run build -w @chfree/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/robots.txt >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
