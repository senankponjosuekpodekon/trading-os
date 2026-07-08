from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import os

router = APIRouter()

# ── Provider config ──────────────────────────────────────────
LLM_PROVIDER    = os.getenv("LLM_PROVIDER", "openai").lower()   # "openai" | "ollama"
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL", "gpt-4o")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "llama3.2")

# Auto-detect Ollama si OpenAI non configuré et provider = openai
def _effective_provider() -> str:
    if LLM_PROVIDER == "ollama":
        return "ollama"
    if OPENAI_API_KEY:
        return "openai"
    return "mock"

def _effective_model() -> str:
    p = _effective_provider()
    if p == "ollama":  return OLLAMA_MODEL
    if p == "openai":  return OPENAI_MODEL
    return "mock"


class ExplainRequest(BaseModel):
    symbol:     str
    timeframe:  str
    signal:     str
    confidence: float
    explanation: str
    indicators: dict
    price_action: Optional[dict] = None
    regime:     Optional[dict] = None
    smc:        Optional[dict] = None
    language:   str = "fr"


class WeeklyReportRequest(BaseModel):
    trades:     list
    win_rate:   float
    total_pnl:  float
    best_trade: Optional[dict] = None
    worst_trade: Optional[dict] = None
    language:   str = "fr"


def _build_signal_prompt(req: ExplainRequest) -> str:
    ind = req.indicators
    pa  = req.price_action or {}
    reg = req.regime or {}
    smc = req.smc or {}

    parts = [
        f"Tu es un analyste trading professionnel. Explique ce signal de manière claire et pédagogique.",
        f"",
        f"## Signal",
        f"- Actif : {req.symbol}",
        f"- Timeframe : {req.timeframe}",
        f"- Direction : {req.signal}",
        f"- Confiance : {req.confidence:.0f}%",
        f"",
        f"## Indicateurs techniques",
        f"- Prix actuel : {ind.get('close', '?')}",
        f"- EMA20 : {ind.get('ema20', '?')} | EMA50 : {ind.get('ema50', '?')} | EMA200 : {ind.get('ema200', '?')}",
        f"- RSI(14) : {ind.get('rsi', '?')}",
        f"- ATR(14) : {ind.get('atr', '?')}",
        f"- Volume ratio : {ind.get('volume_ratio', '?')}x",
        f"- MACD hist : {ind.get('macd_hist', '?')} | Signal : {ind.get('macd_signal', '?')}",
        f"- Bollinger Upper : {ind.get('bb_upper', '?')} | Mid : {ind.get('bb_mid', '?')} | Lower : {ind.get('bb_lower', '?')}",
        f"",
        f"## Raisons du signal (engine)",
        f"{req.explanation}",
    ]

    if pa.get('trend'):
        parts += [
            f"",
            f"## Structure de marché (Price Action)",
            f"- Tendance : {pa.get('trend')}",
            f"- Structure : {pa.get('structure', '?')}",
            f"- BOS : {'oui' if pa.get('bos') else 'non'} | CHoCH : {'oui' if pa.get('choch') else 'non'}",
        ]

    if reg.get('regime'):
        parts += [
            f"",
            f"## Régime de marché",
            f"- Régime : {reg.get('regime')} | ADX : {reg.get('adx', '?')} | Trend dir : {reg.get('trend_dir', '?')}",
        ]

    if smc.get('fvg'):
        fvg_count = len(smc.get('fvg', []))
        ob_count  = len(smc.get('ob', []))
        parts += [
            f"",
            f"## Smart Money Concepts",
            f"- FVG actifs : {fvg_count} | Order Blocks : {ob_count}",
        ]

    parts += [
        f"",
        f"## Ta mission",
        f"Explique ce signal en 3-5 phrases maximum en {req.language}.",
        f"Mentionne : la direction, les indicateurs clés qui confirment, les niveaux importants, et le risque.",
        f"Sois direct et actionnable. Pas de jargon inutile.",
    ]

    return "\n".join(parts)


def _build_report_prompt(req: WeeklyReportRequest) -> str:
    trades_summary = "\n".join([
        f"- {t.get('symbol','?')} {t.get('direction','?')} : PnL ${t.get('pnl',0):.2f} ({t.get('pnl_pct',0):.2f}%)"
        for t in req.trades[:10]
    ])

    return f"""Tu es un coach trading. Génère un rapport hebdomadaire synthétique et motivant.

## Performance de la semaine
- Win Rate : {req.win_rate:.1f}%
- PnL total : ${req.total_pnl:.2f}
- Nombre de trades : {len(req.trades)}
{f"- Meilleur trade : {req.best_trade}" if req.best_trade else ""}
{f"- Pire trade : {req.worst_trade}" if req.worst_trade else ""}

## Trades
{trades_summary}

## Ta mission
Rédige un rapport en {req.language} avec :
1. Résumé de la performance (2-3 phrases)
2. Points forts observés
3. Points à améliorer
4. Conseil pour la semaine prochaine

Sois encourageant mais honnête. Maximum 200 mots."""


async def _call_llm(prompt: str, max_tokens: int = 400) -> str:
    provider = _effective_provider()

    if provider == "mock":
        return _mock_response(prompt)

    try:
        from openai import AsyncOpenAI

        if provider == "ollama":
            # Ollama expose une API compatible OpenAI sur /v1
            client = AsyncOpenAI(
                base_url=f"{OLLAMA_BASE_URL}/v1",
                api_key="ollama",  # Ollama n'exige pas de vraie clé
            )
            model = OLLAMA_MODEL
        else:
            client = AsyncOpenAI(api_key=OPENAI_API_KEY)
            model  = OPENAI_MODEL

        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()

    except Exception as e:
        return _mock_response(prompt, error=str(e))


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
    explanation = await _call_llm(prompt, max_tokens=350)
    return {
        "symbol":      req.symbol,
        "signal":      req.signal,
        "confidence":  req.confidence,
        "ai_explanation": explanation,
        "model":       _effective_model(),
        "provider":    _effective_provider(),
        "language":    req.language,
    }


@router.post("/llm/weekly-report")
async def weekly_report(req: WeeklyReportRequest):
    prompt = _build_report_prompt(req)
    report = await _call_llm(prompt, max_tokens=500)
    return {
        "report":   report,
        "trades":   len(req.trades),
        "win_rate": req.win_rate,
        "total_pnl": req.total_pnl,
        "model":    _effective_model(),
    }


@router.get("/llm/health")
def llm_health():
    provider = _effective_provider()
    return {
        "provider":          provider,
        "model":             _effective_model(),
        "openai_configured": bool(OPENAI_API_KEY),
        "ollama_url":        OLLAMA_BASE_URL if provider == "ollama" else None,
        "status":            "ready" if provider != "mock" else "mock_mode",
    }
