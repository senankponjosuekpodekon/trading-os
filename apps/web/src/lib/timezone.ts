/**
 * Format a date/time in the user's timezone (or browser timezone as fallback).
 */

function resolveTimezone(tz?: string | null): string {
  if (tz && tz !== 'UTC') return tz;
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return browserTz || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatDateTime(date: string | Date | number, timezone?: string | null): string {
  const d = new Date(date);
  const tz = resolveTimezone(timezone);
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: tz,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleString('fr-FR');
  }
}

export function formatTime(date: string | Date | number, timezone?: string | null): string {
  const d = new Date(date);
  const tz = resolveTimezone(timezone);
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleTimeString('fr-FR');
  }
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Detect the trading session based on UTC hour.
 * Returns the active session name or null if none.
 */
export function getTradingSession(date: string | Date | number = Date.now()): string | null {
  const d = new Date(date);
  const utcHour = d.getUTCHours();
  const utcDay = d.getUTCDay();

  // Weekend check (Saturday=6, Sunday=0) — Forex/Crypto only
  const isWeekend = utcDay === 0 || utcDay === 6;

  // Sydney: 22:00–07:00 UTC
  // Tokyo: 00:00–09:00 UTC
  // London: 08:00–17:00 UTC
  // New York: 13:00–22:00 UTC

  if (isWeekend) {
    // Crypto/Synthetic trade 24/7, but traditional sessions are closed
    if (utcHour >= 0 && utcHour < 24) return 'Weekend (Crypto/Synthetic only)';
  }

  const sessions: string[] = [];
  if (utcHour >= 22 || utcHour < 7) sessions.push('Sydney');
  if (utcHour >= 0 && utcHour < 9) sessions.push('Tokyo');
  if (utcHour >= 8 && utcHour < 17) sessions.push('London');
  if (utcHour >= 13 && utcHour < 22) sessions.push('New York');

  // Highlight overlaps
  if (sessions.includes('London') && sessions.includes('New York')) return 'London/NY Overlap';
  if (sessions.includes('Tokyo') && sessions.includes('London')) return 'Tokyo/London Overlap';

  return sessions[0] ?? null;
}
