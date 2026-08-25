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

echo "==> Building API dist on host"
npm install --workspace=apps/api
npx prisma generate --schema=apps/api/prisma/schema.prisma
npm run build --workspace=apps/api

echo "==> Building images"
docker compose -f docker-compose.prod.yml build

echo "==> Deploying services"
docker compose -f docker-compose.prod.yml up -d

echo "==> Waiting for API to be ready"
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "API is healthy"
    break
  fi
  echo "  Waiting for API... ($i/30)"
  sleep 5
done

echo "==> Running engine migrations (llm_cache)"
docker compose -f docker-compose.prod.yml exec -T api npx prisma db execute --schema=./prisma/schema.prisma --stdin < apps/engine/scripts/migrations/20260804220000_add_llm_cache_table.sql || echo "[deploy] llm_cache migration skipped (may already exist)"

echo "==> Cleanup"
docker image prune -f

echo "==> Deployment complete"
