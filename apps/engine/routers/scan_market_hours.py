"""Helpers for BRVM and NYSE market hours."""
import time


# BRVM market hours: Mon-Fri 10:00-14:30 UTC
BRVM_OPEN_HOUR = 10
BRVM_CLOSE_HOUR = 14
BRVM_CLOSE_MIN = 30


def _is_brvm_open() -> bool:
    """Check if BRVM market is currently open (Mon-Fri 10:00-14:30 UTC)."""
    now = time.gmtime()
    if now.tm_wday >= 5:  # Saturday=5, Sunday=6
        return False
    hour = now.tm_hour
    minute = now.tm_min
    if hour < BRVM_OPEN_HOUR or hour > BRVM_CLOSE_HOUR:
        return False
    if hour == BRVM_CLOSE_HOUR and minute > BRVM_CLOSE_MIN:
        return False
    return True


def _is_nyse_open() -> bool:
    """Check if NYSE is currently open (Mon-Fri 14:30-21:00 UTC)."""
    now = time.gmtime()
    if now.tm_wday >= 5:
        return False
    hour_min = now.tm_hour * 60 + now.tm_min
    return 870 <= hour_min < 1260  # 14:30 - 21:00 UTC
