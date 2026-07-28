"""Trading session utilities."""
from datetime import datetime, timezone


# Session windows are UTC-based.
# A session is considered active if current time is inside [open, close).
SESSIONS = {
    "Tokyo": (0, 9),
    "London": (7, 16),
    "New_York": (13, 22),
}

OVERLAPS = [
    ("London_New_York", 13, 16),
]


def get_session_info(now: datetime | None = None) -> dict:
    """
    Returns current market session context.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    hour = now.hour
    minute = now.minute
    minute_of_day = hour * 60 + minute

    active_sessions = [name for name, (open_h, close_h) in SESSIONS.items() if open_h <= hour < close_h]

    session = "OFF"
    if active_sessions:
        session = "_".join(sorted(active_sessions))

    overlap = None
    for name, start, end in OVERLAPS:
        if start <= hour < end:
            overlap = name
            break

    # Minutes since the most relevant session open (first active session, or London if none)
    primary = active_sessions[0] if active_sessions else "London"
    open_h = SESSIONS[primary][0]
    minutes_after_session_open = minute_of_day - (open_h * 60)

    return {
        "session": session,
        "overlap": overlap,
        "minutes_after_session_open": minutes_after_session_open,
        "hour": hour,
        "weekday": now.weekday(),
        "is_weekend": now.weekday() >= 5,
    }
