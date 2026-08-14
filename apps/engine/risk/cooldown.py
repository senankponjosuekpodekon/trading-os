"""
Cooldown Manager — Enforce trading pauses after losses.

Features:
  - Mandatory cooldown after a losing trade
  - Progressive cooldown: longer pauses for consecutive losses
  - Max trades per time window (frequency limit)
  - Revenge trade prevention: block immediate re-entry after loss
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from enum import Enum


class CooldownState(Enum):
    ACTIVE = "ACTIVE"          # Normal trading
    COOLING = "COOLING"        # In cooldown period


@dataclass
class CooldownConfig:
    base_cooldown_minutes: int = 5       # Base pause after any loss
    consecutive_loss_multiplier: int = 5  # Additional minutes per consecutive loss
    max_cooldown_minutes: int = 60       # Cap on single cooldown
    max_trades_per_hour: int = 10        # Frequency limit
    revenge_block_seconds: int = 30     # Block re-entry for N seconds after any loss
    max_consecutive_before_long_pause: int = 3  # Trigger long pause
    long_pause_minutes: int = 30        # Long pause duration


@dataclass
class CooldownStatus:
    state: CooldownState
    remaining_seconds: int = 0
    trades_this_hour: int = 0
    consecutive_losses: int = 0
    reason: str = ""


class CooldownManager:
    """Track trade timing and enforce cooldown periods."""

    def __init__(self, config: Optional[CooldownConfig] = None):
        self.config = config or CooldownConfig()
        self.state = CooldownState.ACTIVE
        self.cooldown_until: Optional[datetime] = None
        self.consecutive_losses = 0
        self._trade_timestamps: list[datetime] = []
        self._last_loss_time: Optional[datetime] = None

    def _prune_old_trades(self, now: datetime) -> None:
        """Remove trade timestamps older than 1 hour."""
        cutoff = now - timedelta(hours=1)
        self._trade_timestamps = [t for t in self._trade_timestamps if t > cutoff]

    def _check_cooldown_expired(self, now: datetime) -> None:
        """Transition from COOLING → ACTIVE if cooldown is over."""
        if self.state == CooldownState.COOLING and self.cooldown_until:
            if now >= self.cooldown_until:
                self.state = CooldownState.ACTIVE
                self.cooldown_until = None

    def record_trade(self, now: Optional[datetime] = None) -> None:
        """Record that a trade was placed."""
        now = now or datetime.now(timezone.utc)
        self._trade_timestamps.append(now)
        self._prune_old_trades(now)

    def record_loss(self, now: Optional[datetime] = None) -> None:
        """Record a losing trade and trigger cooldown."""
        now = now or datetime.now(timezone.utc)
        self.consecutive_losses += 1
        self._last_loss_time = now
        self._trade_timestamps.append(now)
        self._prune_old_trades(now)

        # Calculate cooldown duration
        if self.consecutive_losses >= self.config.max_consecutive_before_long_pause:
            duration = self.config.long_pause_minutes
        else:
            duration = self.config.base_cooldown_minutes + (
                self.consecutive_losses - 1
            ) * self.config.consecutive_loss_multiplier

        duration = min(duration, self.config.max_cooldown_minutes)
        self.cooldown_until = now + timedelta(minutes=duration)
        self.state = CooldownState.COOLING

    def record_win(self, now: Optional[datetime] = None) -> None:
        """Record a winning trade — resets consecutive losses."""
        now = now or datetime.now(timezone.utc)
        self.consecutive_losses = 0
        self._trade_timestamps.append(now)
        self._prune_old_trades(now)

    def can_trade(self, now: Optional[datetime] = None) -> tuple[bool, str]:
        """Check if a new trade is allowed."""
        now = now or datetime.now(timezone.utc)
        self._check_cooldown_expired(now)
        self._prune_old_trades(now)

        if self.state == CooldownState.COOLING:
            remaining = int((self.cooldown_until - now).total_seconds()) if self.cooldown_until else 0
            if remaining > 0:
                return False, f"Cooldown active: {remaining}s remaining (consecutive losses: {self.consecutive_losses})"

        # Frequency limit
        if len(self._trade_timestamps) >= self.config.max_trades_per_hour:
            return False, f"Frequency limit: {len(self._trade_timestamps)} trades in last hour (max {self.config.max_trades_per_hour})"

        # Revenge trade prevention
        if self._last_loss_time:
            since_loss = (now - self._last_loss_time).total_seconds()
            if since_loss < self.config.revenge_block_seconds:
                remaining = int(self.config.revenge_block_seconds - since_loss)
                return False, f"Revenge trade block: {remaining}s remaining"

        return True, "ACTIVE"

    def status(self, now: Optional[datetime] = None) -> CooldownStatus:
        """Get current cooldown status."""
        now = now or datetime.now(timezone.utc)
        self._check_cooldown_expired(now)
        self._prune_old_trades(now)

        remaining = 0
        if self.state == CooldownState.COOLING and self.cooldown_until:
            remaining = max(0, int((self.cooldown_until - now).total_seconds()))

        return CooldownStatus(
            state=self.state,
            remaining_seconds=remaining,
            trades_this_hour=len(self._trade_timestamps),
            consecutive_losses=self.consecutive_losses,
            reason=f"Consecutive losses: {self.consecutive_losses}" if self.consecutive_losses > 0 else "",
        )

    def reset(self) -> None:
        """Manual reset (admin override)."""
        self.state = CooldownState.ACTIVE
        self.cooldown_until = None
        self.consecutive_losses = 0
        self._trade_timestamps.clear()
        self._last_loss_time = None
