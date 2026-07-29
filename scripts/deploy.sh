#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Pulling latest changes"
git pull origin vps

echo "==> Updating environment"
if [ ! -f .env ]; then
  echo "ERROR: .env file is missing. Create it before deploying."
  exit 1
fi

echo "==> Building images"
docker compose -f docker-compose.prod.yml build

echo "==> Deploying services"
docker compose -f docker-compose.prod.yml up -d

echo "==> Running database migrations"
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "==> Cleanup"
docker image prune -f

echo "==> Deployment complete"
