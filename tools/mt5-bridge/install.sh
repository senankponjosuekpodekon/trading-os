#!/bin/bash
# Install MT5 + Python (Wine) + bridge sur le VPS unique.
# Validé sur Ubuntu 24.04 (noble) — winehq-devel 11.x REQUIS :
# le wine distro (9.0) déclenche l'anti-debugger de MT5.
# Usage: bash tools/mt5-bridge/install.sh
set -euo pipefail

export WINEPREFIX=${WINEPREFIX:-$HOME/.wine-mt5}
export DEBIAN_FRONTEND=noninteractive
BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
PYDIR="$WINEPREFIX/drive_c/python311"

echo "==> [1/8] Paquets système + WineHQ devel"
dpkg --add-architecture i386 2>/dev/null || true
apt-get update -qq
apt-get install -y -qq xvfb wget cabextract x11-apps xdotool imagemagick > /dev/null

# Wine 9 (distro) est détecté comme debugger par MT5 → écran bloquant.
# WineHQ >= 11.7 passe la protection (fixe communautaire vérifiée).
if ! wine --version 2>/dev/null | grep -qE 'wine-1[0-9]'; then
    mkdir -pm755 /etc/apt/keyrings
    wget -qO- https://dl.winehq.org/wine-builds/winehq.key \
        | gpg --batch --yes --dearmor -o /etc/apt/keyrings/winehq-archive.key
    . /etc/os-release
    wget -q -O /etc/apt/sources.list.d/winehq.sources \
        "https://dl.winehq.org/wine-builds/ubuntu/dists/${VERSION_CODENAME}/winehq-${VERSION_CODENAME}.sources"
    apt-get update -qq
    apt-get install -y --install-recommends winehq-devel > /dev/null
fi
wine --version

# NOTE : ne PAS poser cap_net_raw sur wineserver/wine-preloader.
# Hypothèse "scan ICMP des access-servers" testée et non confirmée
# (le TCP passe sans). setcap sur wine-preloader active le mode
# secure-execution : LD_* ignorés → Wine peut casser.

echo "==> [2/8] Xvfb (:99) — display persistant partagé terminal+bridge"
cat > /etc/systemd/system/xvfb.service <<'EOF'
[Unit]
Description=Xvfb display :99 for MT5
[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1024x768x16
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now xvfb

echo "==> [3/8] Préfixe Wine dédié ($WINEPREFIX)"
export WINEARCH=win64
DISPLAY=:99 wineboot -i 2>/dev/null || true
sleep 3

echo "==> [4/8] MetaTrader 5"
if [ ! -f "$WINEPREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe" ]; then
    wget -q -O /tmp/mt5setup.exe \
        https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
    DISPLAY=:99 wine /tmp/mt5setup.exe /auto || true
    sleep 15
    wineserver -k || true
fi
ls "$WINEPREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe" \
    && echo "MT5 installé" || { echo "ÉCHEC MT5"; exit 1; }

echo "==> [5/8] Python Windows embarqué sous Wine (C:\python311)"
if [ ! -f "$PYDIR/python.exe" ]; then
    # L'installateur MSI échoue sous Wine → package embeddable (zip).
    wget -q -O /tmp/py.zip \
        https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip
    mkdir -p "$PYDIR" && cd "$PYDIR" && unzip -o -q /tmp/py.zip
    # Activer site-packages (fichier ._pth commente 'import site' par défaut)
    sed -i 's/^#import site/import site/' python311._pth 2>/dev/null || true
    wget -q -O get-pip.py https://bootstrap.pypa.io/get-pip.py
    DISPLAY=:99 wine python.exe get-pip.py --quiet
fi
DISPLAY=:99 wine "$PYDIR/python.exe" --version

echo "==> [6/8] Libs Python + patch IPC"
cd "$PYDIR"
# numpy>=2 crash sous Wine (ucrtbase.crealf absent) → pin 1.x.
DISPLAY=:99 wine python.exe -m pip install --quiet \
    "numpy==1.26.4" "pandas<2.1" MetaTrader5 flask
# Patch obligatoire sous Wine : sans lui, mt5.initialize() → -10005 IPC
# timeout (le terminal répond "initializing" indéfiniment).
wget -q -O "$PYDIR/Lib/site-packages/patch_wine_mt5.py" \
    https://raw.githubusercontent.com/blueTheEnigma/wine-mt5-ipc-patch/main/patch_wine_mt5.py

echo "==> [7/8] Bridge + env (/opt/mt5-bridge, /etc/mt5-bridge.env)"
mkdir -p /opt/mt5-bridge
cp "$BRIDGE_DIR/server.py" /opt/mt5-bridge/
if [ ! -f /etc/mt5-bridge.env ]; then
    TOKEN=$(openssl rand -hex 24)
    cat > /etc/mt5-bridge.env <<EOF
# Remplir avec les credentials du compte XM/Exness (démo d'abord !)
# Vides = le bridge s'attache au terminal déjà loggé manuellement.
MT5_LOGIN=
MT5_PASSWORD=
MT5_SERVER=
MT5_BRIDGE_TOKEN=$TOKEN
MT5_BRIDGE_PORT=5555
MT5_READ_ONLY=1
MT5_ALLOWED_SYMBOLS=EURUSD,XAUUSD,GBPUSD,USDJPY,BTCUSD,ETHUSD
MT5_MAX_VOLUME=1.0
MT5_MAX_ORDERS_MIN=10
EOF
    chmod 600 /etc/mt5-bridge.env
    echo "Créé avec token généré — compléter MT5_LOGIN/PASSWORD/SERVER"
else
    echo "Déjà présent, conservé"
fi

echo "==> [8/8] Service systemd"
# PAS de service mt5-terminal : la lib MetaTrader5 spawn/manage le terminal
# elle-même (mode /portable) — un second terminal crée un conflit IPC.
cat > /etc/systemd/system/mt5-bridge.service <<EOF
[Unit]
Description=MT5 HTTP bridge (Wine)
After=network.target xvfb.service
Requires=xvfb.service

[Service]
Type=simple
Environment=DISPLAY=:99
Environment=WINEPREFIX=$WINEPREFIX
EnvironmentFile=/etc/mt5-bridge.env
ExecStart=/usr/bin/wine "$PYDIR/python.exe" /opt/mt5-bridge/server.py
Restart=always
RestartSec=10
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

# ufw : autoriser le subnet docker à joindre le bridge (bind privé).
# Sans cette règle, l'engine container timeout même si le bridge écoute.
if command -v ufw >/dev/null && ufw status | grep -qi active; then
    ufw allow from 172.16.0.0/12 to any port "${MT5_BRIDGE_PORT:-5555}" \
        comment "mt5-bridge docker" >/dev/null || true
fi

systemctl daemon-reload
systemctl disable --now mt5-terminal 2>/dev/null || true
systemctl enable mt5-bridge
systemctl restart mt5-bridge
sleep 20

echo ""
echo "=== Vérification ==="
systemctl is-active xvfb mt5-bridge
TOKEN=$(grep MT5_BRIDGE_TOKEN /etc/mt5-bridge.env | cut -d= -f2)
curl -s -m 60 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5555/health || true
echo ""
echo "Terminé. Prochaines étapes :"
echo "  1. health → initialized:true confirme l'IPC (peut prendre ~2 min)"
echo "  2. connected:true exige un compte : soit MT5_LOGIN/PASSWORD/SERVER"
echo "     dans /etc/mt5-bridge.env, soit login manuel dans le terminal"
echo "  3. .env trading-os : MT5_BRIDGE_URL=http://host.docker.internal:5555"
echo "     + MT5_BRIDGE_TOKEN=<même token> → recréer le container engine"
