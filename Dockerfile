FROM node:20-slim

# Playwright Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PLAYWRIGHT_BROWSERS_PATH=/usr
ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./

ENV NODE_ENV=production
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
