#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 24 --silent

echo "🐳 Starting infra (postgres + redis)..."
docker compose -f "$ROOT/docker-compose.yml" up postgres redis -d

echo "⏳ Waiting for healthchecks..."
sleep 6

echo "� Freeing ports..."
kill $(lsof -ti:8000) 2>/dev/null || true
kill $(lsof -ti:3001) 2>/dev/null || true
kill $(lsof -ti:3000) 2>/dev/null || true
sleep 1

echo "�🐍 Starting Python Engine (port 8000)..."
cd "$ROOT/apps/engine"
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-delay 1 --timeout-graceful-shutdown 2 &> /tmp/engine.log &
ENGINE_PID=$!

echo "🟡 Starting NestJS API (port 3001)..."
cd "$ROOT/apps/api"
"$ROOT/node_modules/.bin/nest" start --watch &> /tmp/api.log &
API_PID=$!

echo "🌐 Starting Next.js Web (port 3000)..."
cd "$ROOT/apps/web"
node_modules/.bin/next dev --port 3000 &> /tmp/web.log &
WEB_PID=$!

echo ""
echo "✅ Trading OS running:"
echo "   Web     → http://localhost:3000"
echo "   API     → http://localhost:3001/api/health"
echo "   Engine  → http://localhost:8000/docs"
echo "   DB      → localhost:5433"
echo "   Redis   → localhost:6380"
echo ""
echo "Logs: /tmp/engine.log | /tmp/api.log | /tmp/web.log"
echo "Press Ctrl+C to stop all services"

trap "kill \$ENGINE_PID \$API_PID \$WEB_PID 2>/dev/null; docker compose -f '$ROOT/docker-compose.yml' stop postgres redis" EXIT
wait
