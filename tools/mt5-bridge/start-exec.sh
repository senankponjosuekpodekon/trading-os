#!/usr/bin/env bash
# Démarre l'instance EXECUTION (Deriv-Demo) — séparée du sandbox read-only.
# 1er run : ouvrir le bureau VNC (127.0.0.1:26901) et logger le terminal
# sur Deriv-Demo (login attendu : MT5_EXPECTED_LOGIN, défaut 41330108),
# OU remplir MT5_LOGIN/MT5_PASSWORD/MT5_SERVER dans .env.exec.local.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/.env.exec.local" ]; then
    read -r -s -p 'Choose a dedicated exec desktop password (at least 12 characters): ' MT5_EXEC_DESKTOP_PASSWORD
    printf '\n'
    if [ "${#MT5_EXEC_DESKTOP_PASSWORD}" -lt 12 ]; then
        echo 'Password too short.' >&2
        exit 1
    fi
    MT5_EXEC_BRIDGE_TOKEN="$(openssl rand -hex 32)"
    cat > "$DIR/.env.exec.local" <<EOF
MT5_EXEC_DESKTOP_PASSWORD=${MT5_EXEC_DESKTOP_PASSWORD}
MT5_EXEC_BRIDGE_TOKEN=${MT5_EXEC_BRIDGE_TOKEN}
# Identifiants optionnels pour l'auto-login (sinon login manuel via VNC):
# MT5_LOGIN=41330108
# MT5_PASSWORD=
# MT5_SERVER=Deriv-Demo
EOF
    chmod 600 "$DIR/.env.exec.local"
    echo "Wrote $DIR/.env.exec.local (bridge token generated)."
fi

docker compose --env-file "$DIR/.env.exec.local" -f "$DIR/compose.exec.yaml" up -d --no-build
echo "Exec bridge starting: API on 172.17.0.1:5555, VNC on 127.0.0.1:26901"
echo "Then update API env: MT5_SERVER=Deriv-Demo, MT5_BRIDGE_TOKEN=<token in .env.exec.local>"
