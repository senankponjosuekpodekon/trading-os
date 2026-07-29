# This Dockerfile expects the BUILD CONTEXT to be the monorepo root
# (see docker-compose.prod.yml: context: ., dockerfile: apps/web/Dockerfile).
# apps/web depends on the npm workspaces hoisting done at the repo root —
# building with context: ./apps/web in isolation causes non-deterministic
# "Module not found" failures (missing hoisted transitive dependencies).

# Stage 1 — build
FROM node:24-alpine AS builder

WORKDIR /repo

COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000 \
    && npm install --workspace=apps/web

COPY apps/web ./apps/web

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time —
# they must be passed as build ARGs (via docker-compose.prod.yml build.args),
# not just runtime environment/env_file (too late for Next.js).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ENGINE_URL
ARG NEXT_PUBLIC_ENGINE_WS_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_ENGINE_URL=$NEXT_PUBLIC_ENGINE_URL
ENV NEXT_PUBLIC_ENGINE_WS_URL=$NEXT_PUBLIC_ENGINE_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

RUN npm run build --workspace=apps/web

# Stage 2 — production
FROM node:24-alpine

WORKDIR /repo

ENV NODE_ENV=production

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/web ./apps/web

WORKDIR /repo/apps/web

EXPOSE 3000

CMD ["npm", "start"]
