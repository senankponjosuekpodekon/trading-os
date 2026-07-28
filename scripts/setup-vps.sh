#!/usr/bin/env bash
set -e

echo "== Trading-OS VPS setup =="

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "${USER}"
fi

# Install Docker Compose plugin
if ! docker compose version &> /dev/null; then
  sudo apt-get update && sudo apt-get install -y docker-compose-plugin
fi

# Clone repository (replace with your repo URL)
APP_DIR="${APP_DIR:-/opt/trading-os}"
if [ ! -d "$APP_DIR" ]; then
  git clone https://github.com/your-org/trading-os.git "$APP_DIR" || true
fi

cd "$APP_DIR"

# Create env file from example if missing
if [ ! -f .env ]; then
  cp .env.production.example .env
  echo "Created .env from .env.production.example — update secrets before starting!"
fi

# Prepare directories
mkdir -p nginx/ssl backups

echo "VPS ready. Run ./scripts/deploy.sh to deploy."
