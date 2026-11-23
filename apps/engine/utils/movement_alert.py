"""Alerte de mouvement anormal — indépendante du moteur de signaux.

Le scanner cherche des setups BUY/SELL avec SL/TP cohérents : sur des actifs
comme les indices synthétiques (random-walk à vol constante), il répond NEUTRAL
quasi tout le temps — y compris pendant une hausse violente. Ce module répond
à un besoin différent : prévenir qu'un actif suivi bouge anormalement,
sans prétendre que c'est un trade.

Détection : variation des 3 dernières bougies closes normalisée par l'ATR14.
Un move >= MOVE_Z_MIN × ATR ET |Δ%| >= MOVE_PCT_MIN déclenche un broadcast
dédupliqué (clé Redis, cooldown 4h par symbole) via le canal push existant.
Fail-open : une erreur ne doit jamais casser le scan.
"""
from __future__ import annotations

import os

import pandas as pd

from utils.logger import get_logger
from utils.push_notify import broadcast_once

logger = get_logger(__name__)

# Paramètres par défaut — surchargables par env
MOVE_WINDOW = int(os.environ.get("MOVE_ALERT_WINDOW", "3"))          # bougies
MOVE_Z_MIN = float(os.environ.get("MOVE_ALERT_Z_MIN", "3.0"))        # × ATR
MOVE_PCT_MIN = float(os.environ.get("MOVE_ALERT_PCT_MIN", "0.5"))    # % absolu mini
MOVE_COOLDOWN = int(os.environ.get("MOVE_ALERT_COOLDOWN_S", str(4 * 3600)))


def _atr14(df: pd.DataFrame) -> float | None:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(14).mean().iloc[-1]
    return float(atr) if pd.notna(atr) and atr > 0 else None


async def check_price_move(symbol: str, df: pd.DataFrame, timeframe: str) -> None:
    """Détecte un mouvement anormal sur les dernières bougies et broadcast
    une alerte dédupliquée. No-op silencieux si données insuffisantes."""
    try:
        need = MOVE_WINDOW + 15
        if df is None or len(df) < need:
            return

        atr = _atr14(df)
        if not atr:
            return

        close = df["close"].astype(float)
        c_now = float(close.iloc[-1])
        c_ref = float(close.iloc[-1 - MOVE_WINDOW])
        if c_ref <= 0 or c_now <= 0:
            return

        move_pct = (c_now - c_ref) / c_ref * 100.0
        move_abs = abs(c_now - c_ref)
        z = move_abs / atr

        if z < MOVE_Z_MIN or abs(move_pct) < MOVE_PCT_MIN:
            return

        direction = "hausse" if move_pct > 0 else "baisse"
        arrow = "+" if move_pct > 0 else ""
        sent = await broadcast_once(
            dedup_key=f"move:{symbol}:{timeframe}",
            title=f"⚡ Mouvement fort — {symbol}",
            message=(
                f"{symbol} : {arrow}{move_pct:.2f}% sur {MOVE_WINDOW}×{timeframe} "
                f"({z:.1f}× ATR) — {direction} anormale, vérifiez avant d'agir."
            ),
            data={
                "kind": "price_move",
                "symbol": symbol,
                "timeframe": timeframe,
                "move_pct": round(move_pct, 3),
                "atr_mult": round(z, 2),
                "window_candles": MOVE_WINDOW,
            },
            cooldown_seconds=MOVE_COOLDOWN,
        )
        if sent:
            logger.info(
                "price_move_alerted",
                symbol=symbol, timeframe=timeframe,
                move_pct=round(move_pct, 3), atr_mult=round(z, 2),
            )
    except Exception as exc:  # jamais bloquant pour le scan
        logger.debug("price_move_check_failed", symbol=symbol, error=str(exc))
