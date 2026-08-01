"""
Centralized Deriv wire-symbol translation.

Deriv renamed some legacy indices with a "N" suffix on the API side,
while the display/internal symbols used everywhere else (frontend,
DERIV_SYMBOLS, SYMBOL_TO_DERIV) remain unchanged.

This module provides the single source of truth for that mapping.
All modules that make network calls to Deriv should use `to_wire_symbol()`.
"""
_DERIV_WIRE_ALIASES: dict[str, str] = {
    "BOOM300": "BOOM300N",
    "CRASH300": "CRASH300N",
}


def to_wire_symbol(symbol: str) -> str:
    """Translate an internal/display symbol to its Deriv API wire symbol."""
    return _DERIV_WIRE_ALIASES.get(symbol, symbol)
