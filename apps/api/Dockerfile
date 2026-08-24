# Stage 1 — build
FROM node:24-alpine AS builder

WORKDIR /app

# Copy root package.json + lockfile for reproducible workspace install
COPY package*.json ./
COPY . .

RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000 \
    && npm install --force

WORKDIR /app/apps/api

RUN npx prisma generate && npm run build

# Stage 2 — production
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY . .

RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000 \
    && npm install --force --omit=dev

WORKDIR /app/apps/api

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/apps/api/entrypoint.sh ./entrypoint.sh

RUN chmod +x entrypoint.sh && apk add --no-cache wget

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
