"""Hysteresis and persistence helpers for scan signals."""


_signal_state: dict[str, dict] = {}
_HYSTERESIS_CONFIRM = 2   # scans consécutifs pour confirmer
_HYSTERESIS_TTL     = 3600  # réinitialise l'état après 1h sans scan
_PERSISTENCE_WINDOW = 5    # fenêtre glissante (nb de scans) pour le persistence_score


def apply_hysteresis_and_persistence(
    results: list,
    timeframe: str,
    signal_state: dict,
    now_mono: float,
) -> None:
    """
    Hystérésis flip-flop + persistence_score (Sprint 4), mutation in-place de `results`.
    Règles :
      - Un signal BUY/SELL doit être produit _HYSTERESIS_CONFIRM fois consécutivement pour être "confirmé".
      - Un signal confirmé repasse NEUTRAL seulement si la confidence descend sous 25 (bande morte).
      - L'état expire après _HYSTERESIS_TTL secondes sans scan.
      - persistence_score (0-100%) : fraction des _PERSISTENCE_WINDOW derniers scans allant
        dans la même direction que le signal courant — enrichit le compteur binaire d'hystérésis.
    """
    for r in results:
        sig = r.get("signal", "NEUTRAL")
        key = f"{r['symbol']}:{timeframe}:{r.get('strategy_id', 'default')}"
        state = signal_state.get(key)

        # Expiration TTL
        if state and (now_mono - state["ts"]) > _HYSTERESIS_TTL:
            state = None
            signal_state.pop(key, None)

        if sig in ("BUY", "SELL"):
            if state and state["signal"] == sig:
                state["count"] = min(state["count"] + 1, _HYSTERESIS_CONFIRM + 1)
                state["ts"] = now_mono
            else:
                # Nouvelle direction — réinitialiser compteur et historique
                state = {"signal": sig, "count": 1, "ts": now_mono, "history": []}
                signal_state[key] = state

            history = state.setdefault("history", [])
            history.append(sig)
            del history[:-_PERSISTENCE_WINDOW]
            r["persistence_score"] = round(100 * history.count(sig) / _PERSISTENCE_WINDOW, 2)

            # Pas encore confirmé : dégrader en NEUTRAL pour les notifications
            # (le signal reste dans results avec signal_pending=True pour info)
            if state["count"] < _HYSTERESIS_CONFIRM:
                r["signal_pending"] = True
        else:
            if state:
                history = state.setdefault("history", [])
                history.append("NEUTRAL")
                del history[:-_PERSISTENCE_WINDOW]

            # Signal NEUTRAL : si l'état précédent était confirmé, appliquer bande morte
            if state and state.get("count", 0) >= _HYSTERESIS_CONFIRM:
                conf = r.get("confidence", 0)
                if conf >= 25:
                    # Score encore dans la bande morte → maintenir le signal précédent
                    r["signal"] = state["signal"]
                    r["signal_sticky"] = True
                    history = state.get("history", [])
                    r["persistence_score"] = round(100 * history.count(state["signal"]) / _PERSISTENCE_WINDOW, 2)
                else:
                    signal_state.pop(key, None)
                    r["persistence_score"] = 0
            else:
                signal_state.pop(key, None)
                r["persistence_score"] = 0
