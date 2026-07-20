# BotVisitas — runtime sempre no container
FROM node:20-bookworm-slim

# Dependências de sistema para Chromium headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Usa Chromium do SO (não baixa o do Puppeteer no build)
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
    HEADLESS=true \
    NODE_ENV=production

WORKDIR /app

# Usuário não-root (Chromium exige --no-sandbox, já no código)
RUN groupadd -r bot && useradd -r -g bot -d /app -s /sbin/nologin bot \
    && mkdir -p /app/logs \
    && chown -R bot:bot /app

COPY package.json package-lock.json ./
# --ignore-scripts: não baixa Chromium do Puppeteer (usamos o do SO)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=bot:bot src ./src
COPY --chown=bot:bot scripts ./scripts

USER bot

# SIGTERM chega limpo no Node (compose usa init: true também)
STOPSIGNAL SIGTERM

CMD ["npm", "start"]
