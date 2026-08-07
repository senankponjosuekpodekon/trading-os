"""
Gold Specialist Module — Phase E

Provides gold-specific enhancements for XAU/USD trading:
- DXY inverse correlation: when DXY is bearish, gold gets a bullish bias bonus
- Session awareness: London/NY overlap (13:00-17:00 UTC) = highest volume for gold
- Safe haven behavior: in VOLATILE regime, gold tends to attract inflows (bullish bias)
- ATR adaptation: gold has wider ranges, so ATR multiplier is adjusted

All calculations are look-ahead free and use only data available at scan time.
"""
from typing import Optional
import structlog

log = structlog.get_logger()


# Session windows in UTC hours
SESSION_LONDON = (7, 16)    # 07:00–16:00 UTC
SESSION_NY     = (12, 21)   # 12:00–21:00 UTC
SESSION_OVERLAP = (12, 16)  # London/NY overlap = peak gold volume
SESSION_ASIAN  = (0, 7)     # 00:00–07:00 UTC (low vol for gold)


def _is_in_session(utc_hour: int, session: tuple) -> bool:
    return session[0] <= utc_hour < session[1]


def get_session_info(utc_hour: int) -> dict:
    """Returns session info for gold trading."""
    in_london = _is_in_session(utc_hour, SESSION_LONDON)
    in_ny = _is_in_session(utc_hour, SESSION_NY)
    in_overlap = _is_in_session(utc_hour, SESSION_OVERLAP)
    in_asian = _is_in_session(utc_hour, SESSION_ASIAN)

    if in_overlap:
        session = "LONDON_NY_OVERLAP"
        vol_multiplier = 1.3
    elif in_london:
        session = "LONDON"
        vol_multiplier = 1.1
    elif in_ny:
        session = "NEW_YORK"
        vol_multiplier = 1.0
    elif in_asian:
        session = "ASIAN"
        vol_multiplier = 0.6
    else:
        session = "OFF_HOURS"
        vol_multiplier = 0.4

    return {
        "session": session,
        "vol_multiplier": vol_multiplier,
        "in_london": in_london,
        "in_ny": in_ny,
        "in_overlap": in_overlap,
    }


def dxy_correlation_bonus(
    signal: str,
    dxy_data: Optional[dict],
) -> tuple[int, list[str]]:
    """
    DXY inverse correlation: when Dollar Index is bearish, gold gets bullish bias.
    Returns (score_bonus, reasons).
    """
    if not dxy_data:
        return 0, []

    bonus = 0
    reasons = []

    dxy_trend = dxy_data.get("trend")  # "bullish" | "bearish" | "neutral"
    dxy_change = dxy_data.get("change_pct")

    if dxy_trend == "bearish" and signal == "BUY":
        bonus += 15
        reasons.append(f"DXY bearish ({dxy_change:+.2f}%) → gold bullish bias (+15)")
    elif dxy_trend == "bullish" and signal == "SELL":
        bonus -= 15
        reasons.append(f"DXY bullish ({dxy_change:+.2f}%) → gold bearish bias (-15)")
    elif dxy_trend == "bearish" and signal == "SELL":
        bonus += 5  # counter-trend penalty
        reasons.append("DXY bearish but SELL signal → reduced conviction (+5 penalty)")
    elif dxy_trend == "bullish" and signal == "BUY":
        bonus += 5
        reasons.append("DXY bullish but BUY signal → reduced conviction (+5 penalty)")

    return bonus, reasons


def session_bonus(signal: str, utc_hour: int) -> tuple[int, list[str]]:
    """
    Session-based scoring: gold moves best during London/NY overlap.
    Returns (score_bonus, reasons).
    """
    info = get_session_info(utc_hour)
    bonus = 0
    reasons = []

    if info["session"] == "LONDON_NY_OVERLAP":
        bonus += 10
        reasons.append("Gold session: London/NY overlap (peak volume, +10)")
    elif info["session"] == "LONDON":
        bonus += 5
        reasons.append("Gold session: London (+5)")
    elif info["session"] == "ASIAN":
        bonus -= 8
        reasons.append("Gold session: Asian (low volume for gold, -8)")
    elif info["session"] == "OFF_HOURS":
        bonus -= 12
        reasons.append("Gold session: off-hours (thin liquidity, -12)")

    return bonus, reasons


def safe_haven_bonus(
    signal: str,
    regime: Optional[dict],
) -> tuple[int, list[str]]:
    """
    Safe haven behavior: in VOLATILE regime, gold tends to attract inflows (bullish bias).
    Returns (score_bonus, reasons).
    """
    if not regime:
        return 0, []

    regime_name = regime.get("regime", "UNKNOWN")
    bonus = 0
    reasons = []

    if regime_name == "VOLATILE":
        if signal == "BUY":
            bonus += 12
            reasons.append("VOLATILE regime → gold safe haven inflow bias (+12)")
        else:
            bonus -= 8
            reasons.append("VOLATILE regime → SELL gold against safe haven flow (-8)")

    return bonus, reasons


def gold_atr_adjustment(
    atr: float,
    close: float,
    session_info: dict,
) -> tuple[float, float, float]:
    """
    Adapt ATR multipliers for gold based on session.
    Returns (sl_mult, tp1_mult, tp2_mult).
    """
    vol_mult = session_info.get("vol_multiplier", 1.0)

    # Base multipliers for gold (wider than forex due to higher volatility)
    sl_mult = 2.0 * vol_mult
    tp1_mult = 2.5 * vol_mult
    tp2_mult = 4.0 * vol_mult

    # Cap the multipliers to reasonable bounds
    sl_mult = min(max(sl_mult, 1.0), 4.0)
    tp1_mult = min(max(tp1_mult, 1.5), 6.0)
    tp2_mult = min(max(tp2_mult, 2.5), 8.0)

    return sl_mult, tp1_mult, tp2_mult


def is_gold_symbol(symbol: str) -> bool:
    """Check if the symbol is a gold/XAU symbol."""
    s = symbol.upper().replace("/", "")
    return s in ("XAUUSD", "XAU/USD", "PAXGUSDT", "PAXG/USDT", "XAUUSDT") or "XAU" in s


def gold_specialist_bonus(
    signal: str,
    score: int,
    regime: Optional[dict],
    dxy_data: Optional[dict],
    utc_hour: int,
) -> tuple[int, list[str]]:
    """
    Apply all gold-specific bonuses to the score.
    Only called when the asset is XAU/USD.
    Returns (total_bonus, all_reasons).
    """
    total_bonus = 0
    all_reasons = []

    # DXY correlation
    dxy_bonus, dxy_reasons = dxy_correlation_bonus(signal, dxy_data)
    total_bonus += dxy_bonus
    all_reasons += dxy_reasons

    # Session awareness
    s_bonus, s_reasons = session_bonus(signal, utc_hour)
    total_bonus += s_bonus
    all_reasons += s_reasons

    # Safe haven in volatile regime
    sh_bonus, sh_reasons = safe_haven_bonus(signal, regime)
    total_bonus += sh_bonus
    all_reasons += sh_reasons

    return total_bonus, all_reasons
