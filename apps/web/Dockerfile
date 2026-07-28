# Stage 1 — build
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000 \
    && npm install

COPY . .

RUN npm run build

# Stage 2 — production
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000 \
    && npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
