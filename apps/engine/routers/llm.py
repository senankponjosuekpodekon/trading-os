from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import os

from config import settings

router = APIRouter()

# ── Provider config ──────────────────────────────────────────
LLM_PROVIDER    = (settings.llm_provider or os.getenv("LLM_PROVIDER", "openai")).lower()   # "openai" | "ollama"
OPENAI_API_KEY  = settings.openai_api_key or os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL    = settings.openai_model or os.getenv("OPENAI_MODEL", "gpt-4o")
OLLAMA_BASE_URL = settings.ollama_base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL    = settings.ollama_model or os.getenv("OLLAMA_MODEL", "llama3.2")

# Auto-detect Ollama si OpenAI non configuré et provider = openai
def _effective_provider() -> str:
    if LLM_PROVIDER == "ollama":
        return "ollama"
    if OPENAI_API_KEY:
        return "openai"
    # Auto-detect: if Ollama URL is set, prefer it over mock
    if OLLAMA_BASE_URL:
        return "ollama"
    return "mock"

def _effective_model() -> str:
    p = _effective_provider()
    if p == "ollama":  return OLLAMA_MODEL
    if p == "openai":  return OPENAI_MODEL
    return "mock"


class ExplainRequest(BaseModel):
    symbol:      str
    timeframe:   str
    signal:      str
    confidence:  float
    entry_price:  Optional[float] = None
    stop_loss:    Optional[float] = None
    take_profit_1: Optional[float] = None
    take_profit_2: Optional[float] = None
    risk_reward:  Optional[float] = None
    explanation:  str
    indicators:   dict
    price_action: Optional[dict] = None
    sr_zones:     Optional[dict] = None
    patterns:     Optional[dict] = None
    regime:       Optional[dict] = None
    smc:          Optional[dict] = None
    news_sentiment:    Optional[dict] = None
    scraper_sentiment: Optional[dict] = None
    sentiment_pending: bool = False
    language:     str = "fr"


class Candle(BaseModel):
    t:   str
    o:   float
    h:   float
    l:   float
    c:   float
    vol: float


class ReviewPositionRequest(BaseModel):
    symbol:          str
    timeframe:       str = "1h"
    direction:       str
    status:          str
    entry_price:     float
    exit_price:      Optional[float] = None
    stop_loss:       Optional[float] = None
    take_profit:     Optional[float] = None
    quantity:        float
    cost:            Optional[float] = None   # entry * qty
    max_gain:        Optional[float] = None   # gain potentiel si TP touché
    max_loss:        Optional[float] = None   # perte potentielle si SL touché
    roi_if_tp:       Optional[float] = None   # ROI % si TP
    roi_if_sl:       Optional[float] = None   # ROI % si SL
    risk_reward:     Optional[float] = None
    capital_at_open: Optional[float] = None
    capital_pct:     Optional[float] = None   # % du capital engagé
    pnl:             Optional[float] = None
    pnl_pct:         Optional[float] = None
    opened_at:       Optional[str]   = None
    closed_at:       Optional[str]   = None
    signal_context:  Optional[dict]  = None
    candles_before:  List[Candle]    = []
    candles_during:  List[Candle]    = []
    language:        str = "fr"


class WeeklyReportRequest(BaseModel):
    trades:      list
    win_rate:    float
    total_pnl:   float
    total_cost:  Optional[float] = None
    capital:     Optional[float] = None
    best_trade:  Optional[dict] = None
    worst_trade: Optional[dict] = None
    language:    str = "fr"


class ChatRequest(BaseModel):
    message:        str
    history:        List[dict] = []
    language:       str = "fr"
    asset:          Optional[str] = None
    signal_context: Optional[dict] = None
    market_context: Optional[dict] = None


def _build_signal_prompt(req: ExplainRequest) -> str:
    ind  = req.indicators
    pa   = req.price_action or {}
    sr   = req.sr_zones or {}
    pats = req.patterns or {}
    reg  = req.regime or {}
    smc  = req.smc or {}
    news = req.news_sentiment or {}
    scrp = req.scraper_sentiment or {}

    parts = [
        "Tu es un analyste trading professionnel. Explique ce signal de manière claire et pédagogique.",
        "",
        "## Signal",
        f"- Actif : {req.symbol}",
        f"- Timeframe : {req.timeframe}",
        f"- Direction : {req.signal}",
        f"- Confiance : {req.confidence:.0f}%",
    ]

    if req.entry_price:
        parts += [
            "",
            "## Niveaux de prix",
            f"- Entrée : {req.entry_price}",
            f"- Stop Loss : {req.stop_loss or '—'}",
            f"- TP1 : {req.take_profit_1 or '—'} | TP2 : {req.take_profit_2 or '—'}",
            f"- R/R : {req.risk_reward or '—'}",
        ]

    parts += [
        "",
        "## Indicateurs techniques",
        f"- Prix actuel : {ind.get('close', '?')}",
        f"- EMA20 : {ind.get('ema20', '?')} | EMA50 : {ind.get('ema50', '?')} | EMA200 : {ind.get('ema200', '?')}",
        f"- RSI(14) : {ind.get('rsi', '?')}",
        f"- ATR(14) : {ind.get('atr', '?')}",
        f"- Volume ratio : {ind.get('volume_ratio', '?')}x",
        f"- MACD hist : {ind.get('macd_hist', '?')} | Signal : {ind.get('macd_signal', '?')}",
        f"- Bollinger Upper : {ind.get('bb_upper', '?')} | Mid : {ind.get('bb_mid', '?')} | Lower : {ind.get('bb_lower', '?')}",
        "",
        "## Raisons du signal (engine)",
        f"{req.explanation}",
    ]

    if pa.get('trend'):
        parts += [
            "",
            "## Structure de marché (Price Action)",
            f"- Tendance : {pa.get('trend')}",
            f"- Structure : {pa.get('structure', '?')}",
            f"- BOS : {'oui' if pa.get('bos') else 'non'} | CHoCH : {'oui' if pa.get('choch') else 'non'}",
        ]

    if sr.get('near_support') or sr.get('near_resistance'):
        parts += [
            "",
            "## Supports / Résistances",
            f"- Près d'un support : {'oui' if sr.get('near_support') else 'non'}",
            f"- Près d'une résistance : {'oui' if sr.get('near_resistance') else 'non'}",
        ]
        if sr.get('support_levels'):
            parts.append(f"- Niveaux support : {sr['support_levels'][:3]}")
        if sr.get('resistance_levels'):
            parts.append(f"- Niveaux résistance : {sr['resistance_levels'][:3]}")

    if pats.get('patterns'):
        names = [p.get('name', '?') for p in pats['patterns'][:3]]
        parts += [
            "",
            "## Patterns de bougies",
            f"- Détectés : {', '.join(names)}",
        ]

    if reg.get('regime'):
        parts += [
            "",
            "## Régime de marché",
            f"- Régime : {reg.get('regime')} | ADX : {reg.get('adx', '?')} | Trend dir : {reg.get('trend_dir', '?')}",
        ]

    if smc.get('fvg') or smc.get('ob'):
        fvg_count = len(smc.get('fvg', []))
        ob_count  = len(smc.get('ob', []))
        parts += [
            "",
            "## Smart Money Concepts",
            f"- FVG actifs : {fvg_count} | Order Blocks : {ob_count}",
        ]

    sentiment_parts = []
    if news.get('label'):
        sentiment_parts.append(f"- News ({news['label']}) : score {news.get('score', '?')} | bonus {news.get('bonus', 0):+d}pts")
    if scrp.get('label'):
        sentiment_parts.append(f"- Scraper ({scrp['label']}) : score {scrp.get('score', '?')} | bonus {scrp.get('bonus', 0):+d}pts")
    if sentiment_parts:
        parts += ["", "## Sentiment du marché"] + sentiment_parts
    elif req.sentiment_pending:
        parts += ["", "## Sentiment du marché", "- Analyse sentiment en attente (pas encore dans le cache)"]

    parts += [
        "",
        "## Ta mission",
        f"Explique ce signal en 3-5 phrases maximum en {req.language}.",
        "Mentionne : la direction, les indicateurs clés qui confirment, les niveaux importants (entrée, SL, TP), et le risque.",
        "Si le sentiment est disponible, intègre-le dans l'analyse.",
        "Sois direct et actionnable. Pas de jargon inutile.",
    ]

    return "\n".join(parts)


def _fmt_time(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y à %H:%M UTC")
    except Exception:
        return iso[:16]


def _candle_row(c: Candle) -> str:
    emoji = "📈" if c.c >= c.o else "📉"
    chg   = ((c.c - c.o) / c.o * 100) if c.o else 0
    return f"  {c.t[11:16]} | O:{c.o:.4g}  H:{c.h:.4g}  L:{c.l:.4g}  C:{c.c:.4g}  ({chg:+.2f}%) {emoji}"


def _build_review_prompt(req: ReviewPositionRequest) -> str:
    is_open  = req.status == "OPEN"
    won      = not is_open and req.pnl is not None and req.pnl > 0
    lost     = not is_open and req.pnl is not None and req.pnl < 0
    result_label = (
        "Position OUVERTE (en cours)" if is_open else
        f"PROFIT : +{req.pnl:.2f} $ ({req.pnl_pct:+.2f}%) ✅" if won else
        f"PERTE : {req.pnl:.2f} $ ({req.pnl_pct:+.2f}%) ❌" if lost else
        "Clôturée (PnL non calculé)"
    )
    sig = req.signal_context or {}
    ind = sig.get("indicators", {})
    reg = sig.get("regime", {}) or {}
    pa  = sig.get("price_action", {}) or {}
    smc = sig.get("smc", {}) or {}
    news = sig.get("news_sentiment", {}) or {}
    scrp = sig.get("scraper_sentiment", {}) or {}
    pats = sig.get("patterns", {}) or {}
    sr   = sig.get("sr_zones", {}) or {}

    # Calculs ROI réel
    real_roi = f"{req.pnl_pct:+.2f}%" if req.pnl_pct is not None else "—"
    real_pnl = f"{req.pnl:+.2f} $" if req.pnl is not None else "—"

    # Calcul du gain/perte max manqué si le trade était ouvert mais TP non atteint
    missed_gain: Optional[float] = None
    if not is_open and won and req.max_gain and req.pnl is not None:
        missed_gain = round(req.max_gain - req.pnl, 2) if req.max_gain > req.pnl else None

    parts = [
        "Tu es un analyste trading senior. Effectue une analyse post-trade exhaustive et pédagogique.",
        "",
        "═══════════════════════════════════════",
        f"ANALYSE POST-TRADE — {req.symbol}",
        "═══════════════════════════════════════",
        "",
        "## 1. Résumé du trade",
        f"- Actif        : {req.symbol}",
        f"- Direction    : {req.direction}",
        f"- Timeframe    : {req.timeframe}",
        f"- Ouverture    : {_fmt_time(req.opened_at)}",
        f"- Clôture      : {_fmt_time(req.closed_at) if not is_open else '(toujours ouverte)'}",
        f"- Prix entrée  : {req.entry_price}",
        f"- Prix sortie  : {req.exit_price or '—'}",
        f"- Stop Loss    : {req.stop_loss or '—'}",
        f"- Take Profit  : {req.take_profit or '—'}",
        "",
        "## 2. Taille de position & finances",
        f"- Quantité          : {req.quantity} {req.symbol.split('/')[0]}",
        f"- Argent engagé     : {f'{req.cost:.2f} $' if req.cost else '—'}",
        f"- Capital total     : {f'{req.capital_at_open:.2f} $' if req.capital_at_open else '—'}",
        f"- % du capital      : {f'{req.capital_pct:.1f}%' if req.capital_pct else '—'}",
        f"- R/R               : {f'{req.risk_reward:.2f}' if req.risk_reward else '—'}",
        "",
        "  Scénarios :",
        f"  ✓ Si TP touché : +{req.max_gain:.2f} $ (+{req.roi_if_tp:.2f}%)"
            if req.max_gain and req.roi_if_tp else "  ✓ Si TP touché : —",
        f"  ✗ Si SL touché : -{req.max_loss:.2f} $ (-{req.roi_if_sl:.2f}%)"
            if req.max_loss and req.roi_if_sl else "  ✗ Si SL touché : —",
        "",
        "  Résultat réel :",
        f"  PnL               : {real_pnl} ({real_roi}) — {result_label}",
    ]
    if missed_gain:
        parts.append(f"  Gain manqué (vs TP) : {missed_gain:.2f} $ (clôture avant TP)")
    if not is_open and lost and req.pnl and req.max_loss:
        saved = round(req.max_loss - abs(req.pnl), 2)
        if saved > 0:
            parts.append(f"  Perte évitée (vs SL) : {saved:.2f} $ (clôture avant SL)")

    # ── BASE DE LA DÉCISION (signal)
    if sig:
        parts += [
            "",
            f"## 3. Base de la décision (signal généré le {_fmt_time(str(sig.get('signal_created_at', '')))})",
            f"- Type signal  : {sig.get('signal_type', '?')} | Confiance : {sig.get('confidence', '?')}%",
            f"- Stratégie    : {sig.get('strategy', '?')}",
            f"- Raisons engine : {sig.get('explanation', '—')}",
        ]
        if reg.get("regime"):
            parts.append(f"- Régime marché  : {reg['regime']} | ADX : {reg.get('adx','?')} | Direction : {reg.get('trend_dir','?')}")
        if pa.get("trend"):
            parts.append(f"- Price Action   : {pa['trend']} | BOS : {'oui' if pa.get('bos') else 'non'} | CHoCH : {'oui' if pa.get('choch') else 'non'}")
        if pats.get("pin_bar") or pats.get("engulfing"):
            parts.append(f"- Patterns       : Pin Bar={pats.get('pin_bar','non')} | Engulfing={pats.get('engulfing','non')} | Doji={pats.get('doji','non')}")
        if ind:
            parts += [
                f"- EMA20/50/200  : {ind.get('ema20','?')} / {ind.get('ema50','?')} / {ind.get('ema200','?')}",
                f"- RSI(14)       : {ind.get('rsi','?')} | MACD hist : {ind.get('macd_hist','?')}",
                f"- ATR(14)       : {ind.get('atr','?')} | Volume ratio : {ind.get('volume_ratio','?')}x",
            ]
        if sr.get("near_support") or sr.get("near_resistance"):
            parts.append(f"- S/R proches   : support={sr.get('near_support','non')} | résistance={sr.get('near_resistance','non')}")
        if smc.get("fvg"):
            parts.append(f"- SMC FVG       : {len(smc['fvg'].get('bullish',[]))} haussiers / {len(smc['fvg'].get('bearish',[]))} baissiers ouverts")
        if news.get("label"):
            parts.append(f"- Sentiment news: {news['label']} (score {news.get('score','?')}, bonus {news.get('bonus',0):+d}pts)")
        if scrp.get("label"):
            parts.append(f"- Sentiment scraper: {scrp['label']} (score {scrp.get('score','?')}, bonus {scrp.get('bonus',0):+d}pts)")
    else:
        parts += [
            "",
            "## 3. Base de la décision",
            "- Trade ouvert manuellement (pas de signal automatisé lié)",
        ]

    # ── CONTEXTE PRÉ-TRADE
    if req.candles_before:
        parts += [
            "",
            f"## 4. Contexte pré-trade ({len(req.candles_before)} bougies {req.timeframe} avant l'entrée)",
        ]
        for c in req.candles_before:
            parts.append(_candle_row(c))
        trend_before = "haussier" if req.candles_before[-1].c > req.candles_before[0].o else "baissier"
        parts.append(f"  → Tendance immédiate avant entrée : {trend_before}")

    # ── PENDANT LE TRADE
    if req.candles_during:
        highs  = [c.h for c in req.candles_during]
        lows   = [c.l for c in req.candles_during]
        closes = [c.c for c in req.candles_during]
        max_h  = max(highs)
        min_l  = min(lows)
        last_c = closes[-1]
        tp_hit = req.take_profit and (max_h >= req.take_profit if req.direction == "BUY" else min_l <= req.take_profit)
        sl_hit = req.stop_loss  and (min_l <= req.stop_loss  if req.direction == "BUY" else max_h >= req.stop_loss)

        fav_move = abs(max_h - req.entry_price) if req.direction == "BUY" else abs(req.entry_price - min_l)
        adv_move = abs(req.entry_price - min_l) if req.direction == "BUY" else abs(max_h - req.entry_price)

        parts += [
            "",
            f"## 5. Évolution pendant le trade ({len(req.candles_during)} bougies {req.timeframe})",
            f"- Plus haut atteint : {max_h}  |  Plus bas atteint : {min_l}  |  Clôture finale : {last_c}",
            f"- Mouvement favorable max  : {fav_move:.4g} pts depuis entrée",
            f"- Mouvement adverse max    : {adv_move:.4g} pts depuis entrée",
            f"- TP touché : {'oui ✅' if tp_hit else 'non ❌'}  |  SL touché : {'oui ⚠️' if sl_hit else 'non ✅'}",
            "",
            "  Bougies clés :",
        ]
        for c in req.candles_during:
            parts.append(_candle_row(c))

    # ── MISSION
    parts += [
        "",
        "## 6. Analyse demandée",
        f"Rédige une analyse structurée en {req.language} avec ces 5 sections :",
        "",
        "**A. Contexte et base de la décision**",
        "   Explique sur quoi l'entrée s'est basée (indicateurs, régime, sentiment, signal automatique ou manuel).",
        "   Mentionne l'heure exacte du signal et du point d'entrée.",
        "",
        "**B. Événements avant le trade**",
        "   Décris la structure de marché juste avant l'entrée (tendance pré-trade, momentum, volumes).",
        "",
        "**C. Déroulement du trade**",
        "   Raconte comment le prix a évolué après l'entrée, si le TP ou SL a été touché, les moments clés.",
        "   Mentionne l'heure exacte de clôture si disponible.",
        "",
        "**D. Bilan financier**",
        "   Reprends les chiffres exacts : argent engagé, PnL réalisé, ROI réel.",
        "   Compare avec ce qui aurait été gagné si le TP avait été atteint, et ce qui aurait été perdu si le SL avait été touché.",
        f"   Dis si le R/R était correct pour ce type de setup. Le sizing ({f'{req.capital_pct:.1f}% du capital' if req.capital_pct else 'inconnu'}) était-il approprié ?",
        "",
        "**E. Conseil actionnable**",
        "   1 conseil précis sur la gestion du risque ou du sizing pour améliorer ce type de trade.",
        "",
        "Sois factuel, chronologique et pédagogique. Cite les chiffres fournis dans ton analyse.",
    ]
    return "\n".join(parts)


def _build_report_prompt(req: WeeklyReportRequest) -> str:
    trades_summary = "\n".join([
        f"- {t.get('symbol','?')} {t.get('direction','?')} | "
        f"Entrée: {t.get('entry_price','?')} | Qté: {t.get('quantity','?')} | "
        f"Coût: ${t.get('cost',0):.2f} | "
        f"PnL: ${t.get('pnl',0):.2f} ({t.get('pnl_pct',0):.2f}%) | "
        f"TP max: {'+$'+str(t['max_gain']) if t.get('max_gain') else '—'} | "
        f"SL max: {'-$'+str(t['max_loss']) if t.get('max_loss') else '—'}"
        for t in req.trades[:15]
    ])
    best  = req.best_trade
    worst = req.worst_trade
    roi_total = round((req.total_pnl / req.total_cost) * 100, 2) if req.total_cost and req.total_cost > 0 else None

    return f"""Tu es un coach trading senior. Génère un rapport hebdomadaire complet, factuel et pédagogique.

═══════════════════════════════════════
RAPPORT HEBDOMADAIRE
═══════════════════════════════════════

## Performance globale
- Trades clôturés : {len(req.trades)}
- Win Rate         : {req.win_rate:.1f}%
- PnL réalisé     : ${req.total_pnl:.2f}
{f"- Capital engagé   : ${req.total_cost:.2f}" if req.total_cost else ""}
{f"- ROI global       : {roi_total:+.2f}%" if roi_total is not None else ""}
{f"- Capital actuel   : ${req.capital:.2f}" if req.capital else ""}

## Meilleur trade
{f"- {best.get('symbol')} {best.get('direction')} | Coût: ${best.get('cost',0):.2f} | PnL: +${best.get('pnl',0):.2f} ({best.get('pnl_pct',0):.2f}%) | TP max possible: ${best.get('max_gain') or '?'}" if best else '- Aucun'}

## Pire trade
{f"- {worst.get('symbol')} {worst.get('direction')} | Coût: ${worst.get('cost',0):.2f} | PnL: ${worst.get('pnl',0):.2f} ({worst.get('pnl_pct',0):.2f}%) | SL max possible: -${worst.get('max_loss') or '?'}" if worst else '- Aucun'}

## Détail des trades
{trades_summary}

## Ta mission
Rédige un rapport en {req.language} avec ces 4 sections :
1. **Bilan financier** : reprends les chiffres exacts (PnL, ROI, capital engagé, win rate). Mentionne si le sizing était global adapté.
2. **Points forts** : ce qui a bien fonctionné dans les trades gagnants.
3. **Points à améliorer** : erreurs de sizing, trades contre-tendance, sorties prématurées.
4. **Conseil actionnable** : 1 conseil concret pour la semaine prochaine.

Sois factuel, cite les chiffres. Maximum 300 mots."""


async def _call_llm(prompt: str, max_tokens: int = 400) -> str:
    """Delegate to _call_llm_with_fallback for consistent Ollama→OpenAI→mock chain."""
    text, _provider, _model = await _call_llm_with_fallback(prompt, max_tokens=max_tokens)
    return text


async def _call_llm_with_fallback(prompt: str, max_tokens: int = 400) -> tuple[str, str, str]:
    """Appelle Ollama en priorité, puis OpenAI, puis le mock."""
    try:
        from openai import AsyncOpenAI
    except Exception as e:
        return _mock_response(prompt, error=str(e)), "mock", "mock"

    # 1. Essayer Ollama (local) si configuré
    if OLLAMA_BASE_URL:
        try:
            client = AsyncOpenAI(base_url=f"{OLLAMA_BASE_URL}/v1", api_key="ollama")
            response = await client.chat.completions.create(
                model=OLLAMA_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.7,
            )
            return response.choices[0].message.content.strip(), "ollama", OLLAMA_MODEL
        except Exception:
            pass

    # 2. Essayer OpenAI si configuré
    if OPENAI_API_KEY:
        try:
            client = AsyncOpenAI(api_key=OPENAI_API_KEY)
            response = await client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.7,
            )
            return response.choices[0].message.content.strip(), "openai", OPENAI_MODEL
        except Exception as e:
            return _mock_response(prompt, error=str(e)), "mock", "mock"

    # 3. Fallback mock
    return _mock_response(prompt), "mock", "mock"


def _mock_response(prompt: str, error: str = "") -> str:
    if "signal" in prompt.lower() and "BUY" in prompt:
        return ("Signal BUY détecté sur cet actif. Les EMAs sont alignées à la hausse et le MACD confirme le momentum haussier. "
                "Le RSI se situe en zone neutre à bullish, laissant de la marge avant la zone de surachat. "
                "Veuillez configurer votre clé OPENAI_API_KEY pour obtenir une analyse GPT-4o complète.")
    elif "signal" in prompt.lower() and "SELL" in prompt:
        return ("Signal SELL détecté. Les EMAs indiquent une structure baissière et le MACD est en territoire négatif. "
                "La pression vendeuse semble dominer à ce timeframe. "
                "Veuillez configurer votre clé OPENAI_API_KEY pour une analyse complète.")
    elif error:
        return f"[Mode démo — Erreur OpenAI: {error[:100]}] Configurez OPENAI_API_KEY dans votre .env pour activer GPT-4o."
    else:
        return "Analyse IA indisponible — configurez OPENAI_API_KEY dans votre .env."


@router.post("/llm/explain")
async def explain_signal(req: ExplainRequest):
    prompt = _build_signal_prompt(req)
    explanation, provider, model = await _call_llm_with_fallback(prompt, max_tokens=350)
    return {
        "symbol":      req.symbol,
        "signal":      req.signal,
        "confidence":  req.confidence,
        "ai_explanation": explanation,
        "model":       model,
        "provider":    provider,
        "language":    req.language,
    }


@router.post("/llm/review-position")
async def review_position(req: ReviewPositionRequest):
    prompt = _build_review_prompt(req)
    review = await _call_llm_with_fallback(prompt, max_tokens=900)
    text, provider, model = review
    return {
        "symbol":     req.symbol,
        "direction":  req.direction,
        "status":     req.status,
        "pnl":        req.pnl,
        "pnl_pct":    req.pnl_pct,
        "candles_analyzed": len(req.candles_before) + len(req.candles_during),
        "ai_review":  text,
        "model":      model,
        "provider":   provider,
    }


@router.post("/llm/weekly-report")
async def weekly_report(req: WeeklyReportRequest):
    prompt = _build_report_prompt(req)
    report, provider, model = await _call_llm_with_fallback(prompt, max_tokens=500)
    return {
        "report":   report,
        "trades":   len(req.trades),
        "win_rate": req.win_rate,
        "total_pnl": req.total_pnl,
        "model":    model,
        "provider":  provider,
    }


def _build_chat_system_prompt(req: ChatRequest) -> str:
    base = (
        "Tu es Trading Copilot, un assistant trading professionnel. "
        "Réponds de manière concise, factuelle et actionnable en français. "
        "Tu peux expliquer des signaux, aider à lire les indicateurs, discuter de gestion du risque, "
        "et proposer des idées de stratégies. Ne donne pas de conseils financiers réglementés."
    )
    ctx_parts = []
    if req.asset:
        ctx_parts.append(f"Actif discuté : {req.asset}.")
    if req.signal_context:
        sig = req.signal_context
        summary = (
            f"Signal : {sig.get('signal')} sur {sig.get('symbol')} ({sig.get('timeframe')}), "
            f"confiance {sig.get('confidence')}%, prix d'entrée {sig.get('entry_price')}, "
            f"stop {sig.get('stop_loss')}, TP1 {sig.get('take_profit_1')}, R/R {sig.get('risk_reward')}."
        )
        ctx_parts.append(summary)
    if req.market_context:
        mc = req.market_context
        ctx_parts.append("Contexte marché :")
        if mc.get("fearGreed"):
            fg = mc["fearGreed"]
            ctx_parts.append(f"- Fear & Greed : {fg.get('value')} ({fg.get('classification')}).")
        if mc.get("onChainBtc"):
            btc = mc["onChainBtc"]
            ctx_parts.append(f"- BTC on-chain : prix ${btc.get('price')}, mempool {btc.get('mempoolSize')}, fee reco {btc.get('suggestedFee')} sat/vB.")
        if mc.get("onChainEth"):
            eth = mc["onChainEth"]
            ctx_parts.append(f"- ETH on-chain : prix ${eth.get('price')}, gas median {eth.get('gasPriceMedian')} gwei.")
        if mc.get("spotPerpBasis"):
            for b in mc["spotPerpBasis"]:
                ctx_parts.append(f"- Basis {b.get('symbol')} : {b.get('basis')}%.")
        for cot_key in ("cotBtc", "cotEth"):
            cot = mc.get(cot_key)
            if cot:
                ctx_parts.append(
                    f"- COT {cot.get('asset')} CME (report {cot.get('reportDate')}) : "
                    f"net non-commercial {cot.get('nonCommercialNet')}, open interest {cot.get('openInterest')}."
                )
    if not ctx_parts:
        return base
    return base + "\n\n" + "\n".join(ctx_parts) + "\n\n" + "Utilise ce contexte pour affiner tes réponses si pertinent."


@router.post("/llm/chat")
async def chat(req: ChatRequest):
    system = _build_chat_system_prompt(req)
    messages = [{"role": "system", "content": system}] + req.history[-5:] + [{"role": "user", "content": req.message}]

    # Build a single prompt from messages for the fallback chain
    prompt_parts = [f"[{m['role']}] {m['content']}" for m in messages]
    combined_prompt = "\n\n".join(prompt_parts)

    try:
        from openai import AsyncOpenAI

        # Try Ollama first, then OpenAI, then mock — same fallback chain as everywhere
        if OLLAMA_BASE_URL:
            try:
                client = AsyncOpenAI(base_url=f"{OLLAMA_BASE_URL}/v1", api_key="ollama")
                response = await client.chat.completions.create(
                    model=OLLAMA_MODEL,
                    messages=messages,
                    max_tokens=500,
                    temperature=0.7,
                )
                reply = response.choices[0].message.content.strip()
                return {"reply": reply, "model": OLLAMA_MODEL, "provider": "ollama", "language": req.language}
            except Exception:
                pass

        if OPENAI_API_KEY:
            try:
                client = AsyncOpenAI(api_key=OPENAI_API_KEY)
                response = await client.chat.completions.create(
                    model=OPENAI_MODEL,
                    messages=messages,
                    max_tokens=500,
                    temperature=0.7,
                )
                reply = response.choices[0].message.content.strip()
                return {"reply": reply, "model": OPENAI_MODEL, "provider": "openai", "language": req.language}
            except Exception as e:
                pass

        reply = _mock_chat_response(req.message)
        return {"reply": reply, "model": "mock", "provider": "mock", "language": req.language}

    except Exception as e:
        reply = _mock_chat_response(req.message, error=str(e))
        return {"reply": reply, "model": "mock", "provider": "mock", "language": req.language}


def _mock_chat_response(message: str, error: str = "") -> str:
    msg = message.lower()
    if any(w in msg for w in ("salut", "bonjour", "coucou")):
        return "Bonjour ! Je suis Trading Copilot. Comment puis-je vous aider aujourd'hui ?"
    if "stratégie" in msg:
        return "Une stratégie robuste combine tendance (EMA), momentum (RSI/MACD) et gestion du risque (R/R > 1.5, stop-loss serré). Testez-la dans le Lab avant production."
    if any(w in msg for w in ("signal", "buy", "sell", "achat", "vente")):
        return "Pour analyser un signal, je regarde la confiance, le R/R, le régime de marché et le sentiment. Envoyez-moi l'ID du signal pour une explication détaillée."
    if any(w in msg for w in ("risque", "stop loss", "stop-loss", "sizing")):
        return "Ne risquez jamais plus de 1-2% du capital par trade. Placez le stop-loss sur un niveau technique (support/résistance ou ATR)."
    if error:
        return f"[Mode démo — LLM indisponible : {error[:100]}] Configurez OPENAI_API_KEY ou Ollama."
    return "Je peux vous aider sur les signaux, les stratégies, le backtesting et la gestion du risque. Quel est votre sujet ?"


@router.get("/llm/health")
async def llm_health():
    provider = _effective_provider()

    # If provider is ollama, do a real ping to check if it's actually running
    if provider == "ollama":
        try:
            import httpx
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
                if resp.status_code != 200:
                    provider = "mock"
        except Exception:
            provider = "mock"

    return {
        "provider":          provider,
        "model":             _effective_model() if provider != "mock" else "mock",
        "openai_configured": bool(OPENAI_API_KEY),
        "ollama_url":        OLLAMA_BASE_URL if provider == "ollama" else None,
        "status":            "ready" if provider != "mock" else "mock_mode",
    }
