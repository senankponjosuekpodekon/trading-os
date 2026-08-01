"""
Canonical Risk:Reward calculation.
All modules should import this instead of duplicating the formula.
"""


def compute_rr(
    entry: float,
    stop_loss: float,
    take_profit_1: float,
) -> float:
    """
    Compute Risk:Reward ratio = |TP1 - entry| / |entry - SL|.

    Returns 0.0 if entry == stop_loss (degenerate trade).
    """
    sl_dist = abs(entry - stop_loss)
    if sl_dist == 0:
        return 0.0
    return round(abs(take_profit_1 - entry) / sl_dist, 2)
