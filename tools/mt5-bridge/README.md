# MT5 Bridge — déploiement sur le VPS unique (Linux + Wine)

Un seul serveur : le terminal MT5 tourne **sous Wine** en headless (Xvfb),
le bridge Python (Wine aussi) écoute en local, l'engine docker le joint via
`host.docker.internal`. Latence ~5–20 ms, aucun port exposé publiquement.

```
engine (docker) ──HTTP 172.17.0.1:5555──> bridge (Wine python)
                                              └─ MetaTrader5 lib + patch IPC
                                                  └─ MT5 terminal (Wine)
                                                       └─ compte XM/Exness
```

## Installation automatisée

```bash
bash tools/mt5-bridge/install.sh
```

Le script installe tout : winehq-devel, Xvfb (systemd, display `:99`), le
préfixe `/root/.wine-mt5`, MT5, Python Windows embarqué (`C:\python311`),
les libs, le patch IPC, le bridge (`/opt/mt5-bridge`), `/etc/mt5-bridge.env`
et le service `mt5-bridge.service`.

## Pièges rencontrés (et fixes intégrés au script)

| Problème | Fix |
|---|---|
| MT5 affiche « A debugger has been found » et se ferme | Wine 9 (distro) détecté → **winehq-devel ≥ 11** (repo WineHQ) |
| `mt5.initialize()` → `-10005 IPC timeout` | Handshake bloqué en « initializing » sous Wine → **`patch_wine_mt5.py`** (IAT hook, MIT, `blueTheEnigma/wine-mt5-ipc-patch`), importé au début de `server.py` |
| Crash `ucrtbase.dll.crealf` à l'import numpy | `numpy==1.26.4` + `pandas<2.1` (bug Wine 58943) |
| Installateur Python MSI silencieux KO | Package **embeddable** zip + `import site` décommenté dans `python311._pth` |
| Terminal spawné ×N | **Pas de service terminal** : la lib spawn le terminal elle-même (`/portable`) ; un second terminal crée un conflit IPC |
| Container → bridge timeout | Bind sur l'IP gateway docker (`MT5_BIND_HOST=172.17.0.1`) + règle ufw `allow from 172.16.0.0/12 port 5555` |
| wineserver sans DISPLAY | services avec `Environment=DISPLAY=:99` + `Requires=xvfb.service` |

## Configurer le compte broker

```bash
# /etc/mt5-bridge.env — chmod 600, root only
MT5_LOGIN=<numéro compte démo XM/Exness>
MT5_PASSWORD=<mot de passe>
MT5_SERVER=<serveur broker, ex. XMGlobal-MT5 2>
MT5_BRIDGE_TOKEN=<généré à l'install>
MT5_BIND_HOST=172.17.0.1
MT5_ALLOWED_SYMBOLS=EURUSD,XAUUSD,GBPUSD,USDJPY,BTCUSD,ETHUSD
MT5_MAX_VOLUME=1.0
MT5_MAX_ORDERS_MIN=10
```

Credentials vides → le bridge s'attache à un terminal déjà loggé
(login manuel possible via Xvfb/xdotool ou xRDP).

## Côté engine (.env)

```bash
MT5_BRIDGE_URL=http://host.docker.internal:5555
MT5_BRIDGE_TOKEN=<même token>
# Activation granulaire ensuite : EXECUTION_MODE=live,
# EXECUTION_LIVE_VENUES=MARGIN, GATE_FAIL_CLOSED=1
```

## Vérification

```bash
TOKEN=$(grep MT5_BRIDGE_TOKEN /etc/mt5-bridge.env | cut -d= -f2)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5555/health
# → {"initialized":true,"terminal":"<build>","connected":false}
#    initialized:true = IPC lib↔terminal OK
#    connected:true   = compte broker loggé (exige les credentials)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5555/account
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5555/quote/EURUSD
# Debug visuel : xwd -display :99 -root | convert xwd:- /tmp/mt5.png
```

## Sécurité

- Bind sur IP privée uniquement (`127.0.0.1` ou gateway docker) — jamais `0.0.0.0`
- Bearer token sur chaque requête + whitelist symboles
- `MT5_MAX_VOLUME` + `MT5_MAX_ORDERS_MIN` (rate limit)
- `POST /close-all` = kill switch broker
- `GET /positions` = vérité broker pour la réconciliation périodique

## Fragilités connues

- MT5 sous Wine peut se déconnecter (updates terminal) — `Restart=always`
  + `_ensure()` re-init à chaque requête ; surveiller `journalctl -u mt5-bridge`
- `initialize()` peut prendre 1-2 min (spawn + boot terminal) — le premier
  appel après restart est long, normal
- Compte **dédié trading**, jamais le principal ; démo d'abord
