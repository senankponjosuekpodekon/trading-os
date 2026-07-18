import { Injectable } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

export interface SignalAlertInput {
  symbol: string;
  signal: 'BUY' | 'SELL' | string;
  confidence: number;
  timeframe?: string;
  opportunityScore?: number;
  expectedMove?: {
    move?: number | null;
    move_pct?: number | null;
    horizon?: number | null;
    upper?: number | null;
    lower?: number | null;
    volatility_regime?: string | null;
    atr_pct?: number | null;
  };
  mlConfidence?: number | null;
}

@Injectable()
export class AlertService {
  private opportunityThreshold = 0.65;
  private maxDaily = 5;
  private minIntervalMinutes = 60;

  /** userId -> { date: YYYY-MM-DD, count: number } */
  private dailyCounts = new Map<string, { date: string; count: number }>();

  /** userId:symbol:timeframe -> last sent timestamp */
  private lastSent = new Map<string, Date>();

  constructor(private readonly notifications: NotificationsService) {}

  setOpportunityThreshold(value: number) {
    this.opportunityThreshold = value;
  }

  setMaxDaily(value: number) {
    this.maxDaily = value;
  }

  setMinIntervalMinutes(value: number) {
    this.minIntervalMinutes = value;
  }

  private today() {
    return new Date().toISOString().slice(0, 10);
  }

  private getDailyCount(userId: string): number {
    const record = this.dailyCounts.get(userId);
    const today = this.today();
    if (!record || record.date !== today) return 0;
    return record.count;
  }

  private incrementDailyCount(userId: string) {
    const today = this.today();
    const record = this.dailyCounts.get(userId);
    if (!record || record.date !== today) {
      this.dailyCounts.set(userId, { date: today, count: 1 });
    } else {
      record.count += 1;
    }
  }

  private cooldownKey(userId: string, input: SignalAlertInput): string {
    return `${userId}:${input.symbol}:${input.timeframe ?? 'default'}`;
  }

  private isInCooldown(userId: string, input: SignalAlertInput): boolean {
    const key = this.cooldownKey(userId, input);
    const last = this.lastSent.get(key);
    if (!last) return false;
    const elapsed = (Date.now() - last.getTime()) / 60_000;
    return elapsed < this.minIntervalMinutes;
  }

  /**
   * Decide whether a signal alert should be sent to the user.
   * Filters low-opportunity signals, daily caps and symbol/timeframe cooldowns.
   */
  shouldSend(userId: string, input: SignalAlertInput): boolean {
    const score = input.opportunityScore ?? input.confidence / 100;
    if (score < this.opportunityThreshold) return false;
    if (this.getDailyCount(userId) >= this.maxDaily) return false;
    if (this.isInCooldown(userId, input)) return false;
    return true;
  }

  /**
   * Send a signal alert if it passes the anti-spam filters.
   * Returns the notification if sent, otherwise null.
   */
  sendSignal(userId: string, input: SignalAlertInput) {
    if (!this.shouldSend(userId, input)) {
      return null;
    }

    this.incrementDailyCount(userId);
    this.lastSent.set(this.cooldownKey(userId, input), new Date());

    return this.notifications.pushSignal(userId, {
      symbol: input.symbol,
      signal: input.signal,
      confidence: Math.round((input.opportunityScore ?? input.confidence / 100) * 100),
      expectedMove: input.expectedMove,
      mlConfidence: input.mlConfidence ?? null,
    });
  }

  getStats(userId: string) {
    return {
      sentToday: this.getDailyCount(userId),
      maxDaily: this.maxDaily,
      threshold: this.opportunityThreshold,
      cooldownMinutes: this.minIntervalMinutes,
    };
  }
}
