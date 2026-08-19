# Stage 1 — build do frontend
FROM node:20-bookworm-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2 — runtime
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
    HEADLESS=true \
    NODE_ENV=production \
    DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=3847

WORKDIR /app

RUN groupadd -r bot && useradd -r -g bot -d /app -s /sbin/nologin bot \
    && mkdir -p /app/logs /app/web \
    && chown -R bot:bot /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=bot:bot src ./src
COPY --chown=bot:bot scripts ./scripts
COPY --from=web-build --chown=bot:bot /web/dist ./web/dist

USER bot

EXPOSE 3847
STOPSIGNAL SIGTERM

CMD ["node", "src/dashboard/server.js"]
