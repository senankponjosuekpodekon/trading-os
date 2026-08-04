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

echo "==> Running engine migrations (llm_cache)"
docker compose -f docker-compose.prod.yml exec -T api npx prisma db execute --schema=./prisma/schema.prisma --stdin < apps/engine/scripts/migrations/20260804220000_add_llm_cache_table.sql || echo "[deploy] llm_cache migration skipped (may already exist)"

echo "==> Cleanup"
docker image prune -f

echo "==> Deployment complete"
