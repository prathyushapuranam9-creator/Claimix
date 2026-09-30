# Claimix — one image for the web app, the background worker and migrations.
# Build:  docker compose --profile app build
# The image never contains secrets: configuration comes from the environment at run time.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Dev dependencies are kept: migrations and the worker run through tsx.
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup -S claimix && adduser -S claimix -G claimix \
  && mkdir -p /app/.storage && chown claimix:claimix /app/.storage
COPY --from=build --chown=claimix:claimix /app ./
USER claimix
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["npm", "start"]
