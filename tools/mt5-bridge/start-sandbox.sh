#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
read -r -s -p 'Choose a dedicated sandbox desktop password (at least 12 characters): ' MT5_SANDBOX_DESKTOP_PASSWORD
printf '\n'
if [ "${#MT5_SANDBOX_DESKTOP_PASSWORD}" -lt 12 ]; then
    echo 'Password too short.' >&2
    exit 1
fi
export MT5_SANDBOX_DESKTOP_PASSWORD
MT5_SANDBOX_BRIDGE_TOKEN="$(openssl rand -hex 32)"
export MT5_SANDBOX_BRIDGE_TOKEN
docker network inspect trading-mt5-read >/dev/null 2>&1 || docker network create trading-mt5-read >/dev/null
docker compose --env-file /dev/null -f "$DIR/compose.yaml" up -d --no-build
