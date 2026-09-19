import { Injectable, Logger } from '@nestjs/common';
import * as webPush from 'web-push';
import { NotificationsService } from './notifications.service';
import { NotificationPreferenceService } from './notification-preference.service';

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
  mlRegime?: string | null;
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

  private readonly logger = new Logger(AlertService.name);
  private readonly webPushConfigured: boolean;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prefService: NotificationPreferenceService,
  ) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (publicKey && privateKey && subject) {
      try {
        webPush.setVapidDetails(subject, publicKey, privateKey);
        this.webPushConfigured = true;
      } catch {
        this.webPushConfigured = false;
      }
    } else {
      this.webPushConfigured = false;
    }
  }

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

  private async sendPushAlert(userId: string, input: SignalAlertInput) {
    if (!this.webPushConfigured) return;

    const pref = await this.prefService.getOrCreate(userId);
    if (!pref.pushEnabled || !pref.pushSubscription) return;

    const sub = pref.pushSubscription as unknown as { endpoint: string; keys: { p256dh: string; auth: string } };
    const title = `Signal ${input.signal} — ${input.symbol}`;
    const body = `Confiance ${Math.round((input.opportunityScore ?? input.confidence / 100) * 100)}%${input.timeframe ? ` · ${input.timeframe}` : ''}`;
    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      data: { symbol: input.symbol, signal: input.signal, confidence: input.confidence },
    });

    try {
      await webPush.sendNotification(sub, payload);
      this.logger.log(`Web push sent for ${input.symbol}`);
    } catch (err: any) {
      const msg = err?.message || 'unknown';
      this.logger.error(`Web push failed for ${input.symbol}: ${msg}`);
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await this.prefService.update(userId, { pushEnabled: false, pushSubscription: undefined });
      }
    }
  }

  private async sendTelegramAlert(input: SignalAlertInput) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
    if (!botToken || !chatId) return;

    const confidence = Math.round((input.opportunityScore ?? input.confidence / 100) * 100);
    const tf = input.timeframe ? ` · ${input.timeframe}` : '';
    const emoji = input.signal === 'BUY' ? '🟢' : input.signal === 'SELL' ? '🔴' : '⚪';
    const text = [
      `${emoji} *Signal ${input.signal} — ${input.symbol}*${tf}`,
      `Confiance : *${confidence}%*`,
    ];
    if (input.expectedMove?.move_pct != null) {
      text.push(`Expected move : ±${input.expectedMove.move_pct.toFixed(2)}%`);
    }
    if (input.mlConfidence != null) {
      text.push(`ML confidence : ${input.mlConfidence.toFixed(1)}%`);
    }

    try {
      const axios = await import('axios');
      await axios.default.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          chat_id: chatId,
          text: text.join('\n'),
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        },
        { timeout: 8000 },
      );
      this.logger.log(`Telegram alert sent for ${input.symbol} ${input.signal}`);
    } catch (err: any) {
      const msg = err?.response?.data?.description || err?.message || 'unknown';
      this.logger.error(`Telegram alert failed for ${input.symbol}: ${msg}`);
    }
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

    this.sendTelegramAlert(input).catch(() => {});
    this.sendPushAlert(userId, input).catch(() => {});

    return this.notifications.pushSignal(userId, {
      symbol: input.symbol,
      signal: input.signal,
      confidence: Math.round((input.opportunityScore ?? input.confidence / 100) * 100),
      expectedMove: input.expectedMove,
      mlConfidence: input.mlConfidence ?? null,
      mlRegime: input.mlRegime ?? null,
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
