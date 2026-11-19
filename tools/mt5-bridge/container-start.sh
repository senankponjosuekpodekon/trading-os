#!/usr/bin/env bash
set -euo pipefail

export MT5_READ_ONLY=1
export MT5_BIND_HOST=0.0.0.0
export MT5_BRIDGE_PORT=5555
: "${MT5_BRIDGE_TOKEN:?MT5_BRIDGE_TOKEN is required}"
if [ "${#MT5_BRIDGE_TOKEN}" -lt 32 ]; then
    echo 'MT5_BRIDGE_TOKEN must contain at least 32 characters' >&2
    exit 1
fi

mkdir -p "$HOME/.local/state"
exec 9>"$HOME/.local/state/mt5-sandbox.lock"
flock -n 9 || exit 0
until xdpyinfo >/dev/null 2>&1; do sleep 2; done
WINEDLLOVERRIDES='mscoree,mshtml=' timeout 180s wineboot -u
timeout 60s wineserver -w
PYDIR=/opt/mt5-dist/python

TERMINAL="$WINEPREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe"
export MT5_TERMINAL_PATH='C:\Program Files\MetaTrader 5\terminal64.exe'
if [ ! -f "$TERMINAL" ]; then
    echo 'Complete the MT5 installation in the browser desktop. Do not log in to a broker yet.'
    wine /opt/mt5-dist/mt5setup.exe &
else
    wine "$TERMINAL" &
fi
echo 'Starting read-only bridge; API availability does not imply broker connectivity.'
exec wine "$PYDIR/python.exe" -c 'from waitress import serve; from server import app; serve(app, host="0.0.0.0", port=5555, threads=2)'
