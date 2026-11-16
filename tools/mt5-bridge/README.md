# MT5 Bridge — déploiement sur le VPS unique (Linux + Wine)

Un seul serveur : MT5 terminal tourne **sous Wine** en headless, le bridge
Python (sous Wine aussi) écoute sur `127.0.0.1:5555`, l'engine le joint en
local. Latence ~5–20 ms, aucun port exposé.

```
engine (docker) ──HTTP 127.0.0.1:5555──> bridge (Wine python)
                                              └─ MetaTrader5 lib
                                                  └─ MT5 terminal (Wine)
                                                       └─ compte XM/Exness
```

## 1. Installer Wine + MT5 (une fois)

```bash
sudo dpkg --add-architecture i386
sudo apt update && sudo apt install -y wine64 wine32 xvfb wget
# Installer MT5 dans un préfixe dédié
export WINEPREFIX=$HOME/.wine-mt5
wget https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
xvfb-run wine mt5setup.exe /auto      # installation silencieuse
# Python Windows (la lib MetaTrader5 exige python Windows sous Wine)
wget https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
xvfb-run wine python-3.11.9-amd64.exe /quiet InstallAllUsers=1 PrependPath=1
xvfb-run wine pip install MetaTrader5 flask
```

## 2. Login du compte (une fois, interactif)

```bash
export WINEPREFIX=$HOME/.wine-mt5
xvfb-run wine "$WINEPREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe"
# Se connecter au compte XM/Exness dans le terminal UNE FOIS
# (le bridge re-log via MT5_LOGIN ensuite, mais le premier login valide le compte)
```

⚠️ Alternative sans GUI : le bridge fait `mt5.initialize(login, password, server)`
— si le compte n'a jamais été loggé, l'init peut échouer sur certains brokers.
Tester d'abord.

## 3. Configurer le bridge

```bash
# /etc/mt5-bridge.env — chmod 600, root only
MT5_LOGIN=<numéro compte XM>
MT5_PASSWORD=<mot de passe>
MT5_SERVER=<serveur broker, ex. XMGlobal-MT5 2>
MT5_BRIDGE_TOKEN=<token aléatoire 64 chars>
MT5_ALLOWED_SYMBOLS=EURUSD,XAUUSD,GBPUSD,USDJPY
MT5_MAX_VOLUME=0.5
MT5_MAX_ORDERS_MIN=10
```

## 4. Services systemd

```ini
# /etc/systemd/system/mt5-terminal.service — terminal MT5 sous xvfb
[Unit]
Description=MT5 Terminal (Wine)
After=network.target
[Service]
Environment=WINEPREFIX=/root/.wine-mt5
ExecStart=/usr/bin/xvfb-run -a wine "/root/.wine-mt5/drive_c/Program Files/MetaTrader 5/terminal64.exe"
Restart=always
RestartSec=10

# /etc/systemd/system/mt5-bridge.service
[Unit]
Description=MT5 Bridge HTTP
After=mt5-terminal.service
[Service]
Environment=WINEPREFIX=/root/.wine-mt5
EnvironmentFile=/etc/mt5-bridge.env
ExecStart=/usr/bin/xvfb-run -a wine python server.py
WorkingDirectory=/root/projects/trading-os/tools/mt5-bridge
Restart=always
RestartSec=5
```

## 5. Côté engine (.env)

```bash
MT5_BRIDGE_URL=http://127.0.0.1:5555
MT5_BRIDGE_TOKEN=<même token>
# Puis activation granulaire (UI ou env) :
# EXECUTION_MODE=live, EXECUTION_LIVE_VENUES=MARGIN, GATE_FAIL_CLOSED=1
```

⚠️ Le container engine doit joindre `127.0.0.1:5555` de l'hôte → utiliser
`host.docker.internal` dans `MT5_BRIDGE_URL` ou ajouter
`extra_hosts: ["host.docker.internal:host-gateway"]` au service engine.

## 6. Vérification

```bash
systemctl status mt5-terminal mt5-bridge
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5555/health   # {"connected": true}
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5555/account  # equity broker
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5555/quote/EURUSD
```

## Efficacité sur un seul VPS — points clés

- **Localhost** : latence négligeable vs un second serveur (+5-20ms vs +50-150ms)
- **Xvfb** : MT5 exige un display ; `xvfb-run -a` le fournit headless
- **Reconnexion** : le bridge re-init `mt5` à chaque requête si déconnecté
- **Plafonds** : `MT5_MAX_VOLUME`, `MT5_MAX_ORDERS_MIN`, whitelist symboles
  — même si le compte est compromis, les dégâts sont bornés
- **Kill switch** : `POST /close-all` ferme tout au broker
- **Fragilité connue** : MT5 sous Wine se déconnecte parfois (updates broker).
  Le `Restart=always` + health check le masquent ; surveiller les logs.

## Réconciliation

`GET /positions` = vérité broker. L'engine comparera périodiquement les
positions DB vs broker → toute divergence (fill partiel, position fantôme,
close manuel) est détectable.
