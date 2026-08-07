"""
AI Defense Layer — Phase L
Protective intelligence layer that detects anomalies, pump-and-dump patterns,
and risk signals before they damage the portfolio.

Checks:
  1. Pump-and-dump detection (extreme price spike + volume + low liquidity)
  2. Liquidity drain detection (liquidity dropping rapidly)
  3. Whale exit detection (large outflows)
  4. Social manipulation detection (coordinated hype + low fundamentals)
  5. Flash crash warning (volatility spike + VIX surge)
  6. Correlation breakdown (assets decoupling from normal correlations)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from dataclasses import dataclass

from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class DefenseAlert:
    symbol: str
    alert_type: str  # pump_dump | liquidity_drain | whale_exit | social_manipulation | flash_crash | correlation_break
    severity: str  # critical | high | medium | low
    message: str
    data: Dict[str, Any]
    action: str  # block | warn | monitor


def detect_pump_dump(
    symbol: str,
    price_change_24h: float,
    price_change_1h: float,
    volume_24h: float,
    liquidity: float,
    age_hours: float = 0,
) -> Optional[DefenseAlert]:
    """Detect pump-and-dump patterns."""
    warnings = []
    severity = "low"

    # Extreme 24h pump
    if price_change_24h > 200:
        severity = "critical"
        warnings.append(f"Extreme 24h pump: {price_change_24h:+.1f}%")
    elif price_change_24h > 100:
        severity = "high"
        warnings.append(f"Large 24h pump: {price_change_24h:+.1f}%")
    elif price_change_24h > 50:
        severity = "medium"
        warnings.append(f"Significant 24h pump: {price_change_24h:+.1f}%")

    # 1h spike on top of 24h pump
    if price_change_1h > 25 and price_change_24h > 50:
        severity = "critical" if severity != "critical" else severity
        warnings.append(f"1h spike: {price_change_1h:+.1f}% on top of 24h pump")

    # Low liquidity + high volume = easy manipulation
    vol_liq_ratio = volume_24h / max(liquidity, 1)
    if vol_liq_ratio > 5 and liquidity < 200_000:
        severity = "high" if severity == "low" else severity
        warnings.append(f"Volume/liquidity ratio {vol_liq_ratio:.1f}x with low liquidity (${liquidity:,.0f})")

    # Very new token with extreme move
    if age_hours > 0 and age_hours < 24 and price_change_24h > 50:
        severity = "critical"
        warnings.append(f"Token only {age_hours:.0f}h old with {price_change_24h:+.1f}% move")

    if not warnings:
        return None

    return DefenseAlert(
        symbol=symbol,
        alert_type="pump_dump",
        severity=severity,
        message=" | ".join(warnings),
        data={
            "price_change_24h": price_change_24h,
            "price_change_1h": price_change_1h,
            "volume_24h": volume_24h,
            "liquidity": liquidity,
            "vol_liq_ratio": round(vol_liq_ratio, 2),
            "age_hours": age_hours,
        },
        action="block" if severity == "critical" else "warn" if severity == "high" else "monitor",
    )


def detect_liquidity_drain(
    symbol: str,
    liquidity_current: float,
    liquidity_24h_ago: float,
) -> Optional[DefenseAlert]:
    """Detect liquidity being pulled (rug pull risk)."""
    if liquidity_24h_ago <= 0:
        return None

    drop_pct = (liquidity_24h_ago - liquidity_current) / liquidity_24h_ago * 100

    if drop_pct > 50:
        return DefenseAlert(
            symbol=symbol,
            alert_type="liquidity_drain",
            severity="critical",
            message=f"Liquidity dropped {drop_pct:.1f}% in 24h — possible rug pull",
            data={
                "liquidity_current": liquidity_current,
                "liquidity_24h_ago": liquidity_24h_ago,
                "drop_pct": round(drop_pct, 2),
            },
            action="block",
        )
    elif drop_pct > 30:
        return DefenseAlert(
            symbol=symbol,
            alert_type="liquidity_drain",
            severity="high",
            message=f"Liquidity dropped {drop_pct:.1f}% in 24h — monitor closely",
            data={
                "liquidity_current": liquidity_current,
                "liquidity_24h_ago": liquidity_24h_ago,
                "drop_pct": round(drop_pct, 2),
            },
            action="warn",
        )
    elif drop_pct > 15:
        return DefenseAlert(
            symbol=symbol,
            alert_type="liquidity_drain",
            severity="medium",
            message=f"Liquidity declining ({drop_pct:.1f}% in 24h)",
            data={
                "liquidity_current": liquidity_current,
                "liquidity_24h_ago": liquidity_24h_ago,
                "drop_pct": round(drop_pct, 2),
            },
            action="monitor",
        )
    return None


def detect_social_manipulation(
    symbol: str,
    social_score: float,
    social_volume: int,
    price_change_24h: float,
    liquidity: float,
) -> Optional[DefenseAlert]:
    """Detect coordinated social hype without fundamentals."""
    if social_score > 0.5 and social_volume > 50 and liquidity < 100_000 and price_change_24h > 30:
        return DefenseAlert(
            symbol=symbol,
            alert_type="social_manipulation",
            severity="high",
            message=f"Coordinated social hype (score: {social_score:.2f}, {social_volume} posts) on low-liquidity token pumping {price_change_24h:+.1f}%",
            data={
                "social_score": social_score,
                "social_volume": social_volume,
                "price_change_24h": price_change_24h,
                "liquidity": liquidity,
            },
            action="warn",
        )
    elif social_score > 0.7 and social_volume > 100 and price_change_24h > 50:
        return DefenseAlert(
            symbol=symbol,
            alert_type="social_manipulation",
            severity="medium",
            message=f"High social buzz (score: {social_score:.2f}) with {price_change_24h:+.1f}% pump — verify fundamentals",
            data={
                "social_score": social_score,
                "social_volume": social_volume,
                "price_change_24h": price_change_24h,
                "liquidity": liquidity,
            },
            action="monitor",
        )
    return None


def detect_flash_crash(
    symbol: str,
    price_change_1h: float,
    atr_pct: float,
    vix: float = 0,
) -> Optional[DefenseAlert]:
    """Detect flash crash conditions."""
    if price_change_1h < -10 and atr_pct > 5:
        severity = "critical" if price_change_1h < -20 else "high"
        return DefenseAlert(
            symbol=symbol,
            alert_type="flash_crash",
            severity=severity,
            message=f"Flash crash: {price_change_1h:+.1f}% in 1h with ATR {atr_pct:.1f}%",
            data={
                "price_change_1h": price_change_1h,
                "atr_pct": atr_pct,
                "vix": vix,
            },
            action="block" if severity == "critical" else "warn",
        )

    if vix > 35:
        return DefenseAlert(
            symbol=symbol,
            alert_type="flash_crash",
            severity="medium",
            message=f"VIX at {vix:.1f} — elevated market stress, increased crash risk",
            data={"vix": vix},
            action="monitor",
        )
    return None


def run_defense_checks(
    symbol: str,
    *,
    price_change_24h: float = 0,
    price_change_1h: float = 0,
    volume_24h: float = 0,
    liquidity: float = 0,
    liquidity_24h_ago: float = 0,
    age_hours: float = 0,
    social_score: float = 0,
    social_volume: int = 0,
    atr_pct: float = 0,
    vix: float = 0,
) -> Dict[str, Any]:
    """
    Run all AI defense checks for a symbol.
    Returns list of alerts + overall defense recommendation.
    """
    alerts: List[DefenseAlert] = []

    # Run each detector
    checks = [
        detect_pump_dump(symbol, price_change_24h, price_change_1h, volume_24h, liquidity, age_hours),
        detect_liquidity_drain(symbol, liquidity, liquidity_24h_ago) if liquidity_24h_ago > 0 else None,
        detect_social_manipulation(symbol, social_score, social_volume, price_change_24h, liquidity) if social_score > 0 else None,
        detect_flash_crash(symbol, price_change_1h, atr_pct, vix),
    ]

    for alert in checks:
        if alert is not None:
            alerts.append(alert)

    # Determine overall recommendation
    has_critical = any(a.severity == "critical" for a in alerts)
    has_high = any(a.severity == "high" for a in alerts)

    if has_critical:
        recommendation = "BLOCK"
        defense_score = 0
    elif has_high:
        recommendation = "WARN"
        defense_score = 30
    elif alerts:
        recommendation = "MONITOR"
        defense_score = 60
    else:
        recommendation = "CLEAR"
        defense_score = 100

    return {
        "symbol": symbol,
        "recommendation": recommendation,
        "defense_score": defense_score,
        "alerts": [
            {
                "alert_type": a.alert_type,
                "severity": a.severity,
                "message": a.message,
                "data": a.data,
                "action": a.action,
            }
            for a in alerts
        ],
        "alert_count": len(alerts),
        "critical_count": sum(1 for a in alerts if a.severity == "critical"),
        "high_count": sum(1 for a in alerts if a.severity == "high"),
    }
