#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-latest}"
cd "$(dirname "$0")/.."

echo "==> Pulling latest changes"
git pull origin main

echo "==> Updating environment"
if [ ! -f .env ]; then
  echo "ERROR: .env file is missing. Create it before deploying."
  exit 1
fi

export TAG

echo "==> Deploying services (tag: $TAG)"
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

echo "==> Running database migrations"
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "==> Restarting dependent services if migrations changed schema"
docker compose -f docker-compose.prod.yml restart api web engine

echo "==> Cleanup"
docker system prune -f

echo "==> Deployment complete"
