"""Smart-money tracking — réputation deployers + overlap early-buyers.

Deux signaux mesurés, sans indexeur payant :

1. Réputation deployer : GoPlus renvoie `creator_address`. Nos snapshots
   mesurent l'issue réelle de chaque token tracké → un deployer dont les
   tokens passés ont gagné (+50% vs premier snapshot) a un track record ;
   un deployer de tokens perdants/honeypots est un red flag objectif.

2. Early-buyer overlap : pour les chaînes EVM, l'API Etherscan v2 (clé
   free-tier, multi-chaînes via chainid) liste les premiers transferts
   d'un token. Les wallets qui apparaissent tôt sur ≥2 anciens winners
   sont "smart" ; leur présence sur un nouveau token est un signal.
   Désactivé silencieusement sans ETHERSCAN_API_KEY.

Stockage Redis :
- smartmoney:wallets:{chain}   zset wallet → nombre de wins comme early buyer
- smartmoney:deployers:{chain} zset adresse → nombre de tokens gagnants
- smartmoney:rugs:{chain}      zset adresse → nombre de tokens perdants
- smartmoney:processed         set "chain:addr" déjà jugés (win ou loss)
"""
import time
from typing import Any, Dict, List, Optional

from utils.logger import get_logger

logger = get_logger(__name__)

_WALLETS = "smartmoney:wallets:{chain}"
_DEPLOYERS = "smartmoney:deployers:{chain}"
_RUGS = "smartmoney:rugs:{chain}"
_PROCESSED = "smartmoney:processed"

_ETHERSCAN_V2 = "https://api.etherscan.io/v2/api"
# chainid Etherscan v2 — une seule clé couvre toutes ces chaînes
_CHAIN_IDS = {
    "ethereum": 1, "eth": 1,
    "bsc": 56, "bnb": 56, "binance": 56,
    "base": 8453,
    "arbitrum": 42161, "arbitrum_one": 42161,
    "polygon": 137, "matic": 137,
    "optimism": 10,
    "avalanche": 43114, "avax": 43114,
    "linea": 59144, "scroll": 534352, "blast": 81457,
    "mantle": 5000, "fantom": 250, "cronos": 25,
    "gnosis": 100, "celo": 42220, "polygonzkevm": 1101, "zksync": 324,
}

_WIN_MULT = 1.5     # prix +50% vs premier snapshot = winner
_LOSS_MULT = 0.5    # prix −50% vs premier snapshot = loser
_DEAD = {"0x0000000000000000000000000000000000000000",
         "0x000000000000000000000000000000000000dead"}


def _chain_id(chain: str) -> Optional[int]:
    return _CHAIN_IDS.get((chain or "").lower())


def _settings_key() -> str:
    try:
        import config
        return config.settings.etherscan_api_key or ""
    except Exception:
        return ""


async def fetch_early_buyers(chain: str, token_address: str,
                             max_tx: int = 150) -> List[str]:
    """Premiers acheteurs d'un token via Etherscan v2 tokentx (tri asc).
    Retourne les adresses `to` uniques (zéro/dead exclus). [] sans clé ou hors EVM."""
    key = _settings_key()
    cid = _chain_id(chain)
    if not key or not cid or not token_address:
        return []
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(_ETHERSCAN_V2, params={
                "chainid": cid, "module": "account", "action": "tokentx",
                "contractaddress": token_address, "page": 1,
                "offset": max_tx, "sort": "asc", "apikey": key,
            })
            data = r.json()
        if str(data.get("status")) != "1":
            return []
        buyers: List[str] = []
        seen = set()
        for tx in data.get("result") or []:
            to = (tx.get("to") or "").lower()
            if to and to not in _DEAD and to not in seen:
                seen.add(to)
                buyers.append(to)
        return buyers
    except Exception as exc:
        logger.debug("smartmoney_fetch_failed", chain=chain, error=str(exc)[:120])
        return []


async def update_smart_money_index() -> Dict[str, Any]:
    """Cron : juge chaque token tracké dont l'issue est connue (win/loss) et
    met à jour les index deployers + early buyers. Ne compte qu'une fois par
    token (set processed)."""
    try:
        from utils.cache import cache
        from ml.hidden_gems import _GEM_TRACKED_SET, _load_gem_history
        r = await cache.client()
        tracked = await r.smembers(_GEM_TRACKED_SET)
        processed = await r.smembers(_PROCESSED)
    except Exception as exc:
        return {"status": "unavailable", "error": str(exc)[:120]}

    if isinstance(tracked, (set, frozenset)):
        tracked = [t.decode() if isinstance(t, bytes) else t for t in tracked]
    if isinstance(processed, (set, frozenset)):
        processed = {p.decode() if isinstance(p, bytes) else p for p in processed}

    judged = {"winners": 0, "losers": 0, "pending": 0}
    for item in tracked or []:
        item = item.decode() if isinstance(item, bytes) else item
        if item in processed:
            continue
        chain, _, addr = (item or "").partition(":")
        hist = await _load_gem_history(chain, addr)
        if len(hist) < 2:
            judged["pending"] += 1
            continue
        newest, oldest = hist[0], hist[-1]
        p_now, p_first = float(newest.get("price") or 0), float(oldest.get("price") or 0)
        if not p_now or not p_first:
            judged["pending"] += 1
            continue

        ratio = p_now / p_first
        win, loss = ratio >= _WIN_MULT, ratio <= _LOSS_MULT
        if not (win or loss):
            judged["pending"] += 1
            continue

        creator = (newest.get("creator") or oldest.get("creator") or "").lower()
        try:
            if win:
                judged["winners"] += 1
                if creator:
                    await r.zincrby(_DEPLOYERS.format(chain=chain), 1, creator)
                buyers = await fetch_early_buyers(chain, addr)
                for w in buyers:
                    await r.zincrby(_WALLETS.format(chain=chain), 1, w)
            else:
                judged["losers"] += 1
                if creator:
                    await r.zincrby(_RUGS.format(chain=chain), 1, creator)
            await r.sadd(_PROCESSED, item)
        except Exception as exc:
            logger.debug("smartmoney_index_failed", token=item, error=str(exc)[:120])

    return {"status": "ok", **judged, "ts": int(time.time())}


async def check_token(chain: str, token_address: str,
                      creator_address: str = "") -> Dict[str, Any]:
    """Évalue le smart-money signal d'un token :
    - deployer_wins / deployer_rugs : track record du créateur mesuré par nous
    - smart_wallets : early buyers du token déjà présents sur d'anciens winners
    """
    out = {"deployer_wins": 0, "deployer_rugs": 0, "smart_wallets": 0,
           "known_buyers": [], "score": 0}
    try:
        from utils.cache import cache
        r = await cache.client()
        creator = (creator_address or "").lower()
        if creator:
            w = await r.zscore(_DEPLOYERS.format(chain=chain), creator)
            g = await r.zscore(_RUGS.format(chain=chain), creator)
            out["deployer_wins"] = int(w or 0)
            out["deployer_rugs"] = int(g or 0)

        buyers = await fetch_early_buyers(chain, token_address)
        if buyers:
            top = await r.zrevrange(_WALLETS.format(chain=chain), 0, 499, withscores=True)
            known = {w.decode() if isinstance(w, bytes) else w
                     for w, _ in (top or [])}
            hits = [b for b in buyers if b in known]
            out["smart_wallets"] = len(hits)
            out["known_buyers"] = hits[:10]
    except Exception as exc:
        logger.debug("smartmoney_check_failed", error=str(exc)[:120])

    out["score"] = max(0, min(100,
        out["smart_wallets"] * 25 + out["deployer_wins"] * 30 - out["deployer_rugs"] * 40))
    return out


async def smart_money_status() -> Dict[str, Any]:
    """État de l'index : compteurs par chaîne + note sur la couverture."""
    try:
        from utils.cache import cache
        r = await cache.client()
        chains = {}
        for chain in _CHAIN_IDS:
            if chain in ("eth", "bnb", "binance", "matic", "arbitrum_one", "avax"):
                continue
            nw = await r.zcard(_WALLETS.format(chain=chain))
            nd = await r.zcard(_DEPLOYERS.format(chain=chain))
            nr = await r.zcard(_RUGS.format(chain=chain))
            if nw or nd or nr:
                chains[chain] = {"wallets": int(nw), "deployers": int(nd), "rugs": int(nr)}
        processed = await r.scard(_PROCESSED)
    except Exception as exc:
        return {"status": "unavailable", "error": str(exc)[:120]}
    return {
        "status": "collecting" if not chains else "ok",
        "chains": chains,
        "judged_tokens": int(processed or 0),
        "early_buyers": "etherscan_v2" if _settings_key() else "disabled — ETHERSCAN_API_KEY absente",
        "note": "Deployer reputation fonctionne sans clé (GoPlus creator_address + "
                "issues mesurées par nos snapshots). L'overlap early-buyers EVM "
                "nécessite ETHERSCAN_API_KEY (free tier).",
    }
