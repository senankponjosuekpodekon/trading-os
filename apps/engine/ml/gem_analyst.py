"""
Gem Analyst — couche LLM "analyste crypto" au-dessus des métriques brutes.

Pour chaque gem shortlistée, génère un brief de 2-3 phrases en français :
ce que les données disent réellement, la vigilance principale — le rôle
qu'un coach humain joue manuellement, automatisé sur tout l'univers scanné.

Le LLM ne voit QUE des données mesurées (pas de hallucination de hype) et
son commentaire est mis en cache 6h par token — coût maîtrisé, pas de
re-génération à chaque poll du frontend.
"""
from __future__ import annotations

import json
from typing import Any, Dict

from utils.logger import get_logger

logger = get_logger(__name__)

_LLM_COMMENT_TTL = 6 * 3600  # 6h — le commentaire change avec les métriques


async def gem_llm_comment(gem: Dict[str, Any]) -> Dict[str, Any] | None:
    """
    Génère un brief LLM pour une gem + une conviction numérique (0-100).
    La conviction entre comme feature du modèle auto-calibré (gem_model) —
    le jugement qualitatif du LLM devient mesurable et rétro-testé.
    Cache 6h par token (clé = chain:address). None si LLM indisponible.
    """
    chain = (gem.get("chain") or "").lower()
    addr = gem.get("token_address") or gem.get("symbol") or ""
    if not addr:
        return None

    cache_key = f"gem_llm:{chain}:{addr}"
    try:
        from utils.cache import cache
        r = await cache.client()
        cached = await r.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        r = None

    oc = gem.get("onchain") or {}
    traj = gem.get("trajectory") or {}
    manip = gem.get("manipulation") or {}
    payload = {
        "symbol": gem.get("symbol"), "name": gem.get("name"), "chain": chain,
        "gem_score": gem.get("gem_score"),
        "liquidity_usd": gem.get("liquidity"),
        "volume_24h_usd": gem.get("volume_24h"),
        "price_change_24h_pct": gem.get("price_change_24h"),
        "holders": oc.get("holder_count"), "top10_pct": oc.get("top10_pct"),
        "lp_locked_pct": oc.get("lp_locked_pct"),
        "honeypot": oc.get("honeypot"),
        "buy_ratio_24h": round(
            gem.get("buys_24h", 0) / max(gem.get("buys_24h", 0) + gem.get("sells_24h", 0), 1), 2
        ),
        "holder_growth_24h_pct": traj.get("holder_growth_pct"),
        "tracked_hours": traj.get("tracked_hours"),
        "manipulation_flags": manip.get("flags") or [],
        "narrative": gem.get("narrative"),
        "social_buzz": gem.get("social_buzz"),
        "description": (gem.get("description") or "")[:300],
    }

    prompt = (
        "Tu es un analyste crypto senior. Voici les données RÉELLES mesurées "
        "d'un token DEX. En 2-3 phrases en français : dis ce que les données "
        "montrent concrètement, puis la vigilance principale. Pas de "
        "recommandation d'achat, pas de jargon vide — un brief factuel.\n"
        "Termine OBLIGATOIREMENT par une ligne seule : CONVICTION: NN "
        "(ta conviction que ce token surperforme à 24h, 0-100 — "
        "sois sévère, la moyenne du marché est ~30).\n"
        f"Données: {json.dumps(payload, ensure_ascii=False)}"
    )

    try:
        from routers.llm import _call_llm_with_fallback
        text, provider, _model = await _call_llm_with_fallback(prompt, max_tokens=150)
        if not text or provider == "mock":
            return None
        text = text.strip()
        conviction = None
        m = __import__("re").search(r"CONVICTION\s*:\s*(\d{1,3})", text)
        if m:
            conviction = max(0, min(100, int(m.group(1))))
            text = text[: m.start()].strip()
        out = {"comment": text[:500], "conviction": conviction}
        if r is not None:
            await r.set(cache_key, json.dumps(out), ex=_LLM_COMMENT_TTL)
        return out
    except Exception as exc:
        logger.debug("gem_llm_comment_failed", error=str(exc))
        return None
