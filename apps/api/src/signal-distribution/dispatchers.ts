import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SignalPayload {
  symbol: string;
  signal: string;
  timeframe: string;
  confidence: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  riskReward?: number;
  explanation?: string;
  strategy?: string;
}

@Injectable()
export class TelegramDispatcher {
  private readonly logger = new Logger(TelegramDispatcher.name);
  private readonly botToken: string;

  constructor(private config: ConfigService) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
  }

  async sendToChannel(chatId: string, signal: SignalPayload): Promise<boolean> {
    if (!this.botToken) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — skipping Telegram dispatch');
      return false;
    }

    const text = this.formatSignal(signal);
    const inlineKeyboard = this.buildInlineKeyboard(signal);

    try {
      const payload: any = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      };
      if (inlineKeyboard) {
        payload.reply_markup = { inline_keyboard: inlineKeyboard };
      }

      await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, payload, {
        timeout: 5000,
      });
      this.logger.log(`Signal sent to Telegram chat ${chatId}: ${signal.symbol}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Telegram dispatch failed: ${err?.response?.data?.description || err?.message}`);
      return false;
    }
  }

  async sendToMultiple(chatIds: string[], signal: SignalPayload): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const chatId of chatIds) {
      const ok = await this.sendToChannel(chatId, signal);
      if (ok) sent++;
      else failed++;
    }
    return { sent, failed };
  }

  private formatSignal(s: SignalPayload): string {
    const emoji = s.signal === 'BUY' ? '🟢' : s.signal === 'SELL' ? '🔴' : '⚪';
    const lines = [
      `${emoji} *Signal ${s.signal}* — ${s.symbol}`,
      `⏱ Timeframe: ${s.timeframe} | Confiance: ${s.confidence.toFixed(0)}%`,
    ];
    if (s.strategy) lines.push(`📊 Stratégie: ${s.strategy}`);
    if (s.entryPrice) lines.push(`💰 Entrée: ${s.entryPrice}`);
    if (s.stopLoss) lines.push(`🛑 Stop Loss: ${s.stopLoss}`);
    if (s.takeProfit1) lines.push(`🎯 TP1: ${s.takeProfit1}`);
    if (s.takeProfit2) lines.push(`🎯 TP2: ${s.takeProfit2}`);
    if (s.riskReward) lines.push(`⚖️ R/R: ${s.riskReward.toFixed(2)}`);
    if (s.explanation) lines.push(`\n📝 ${s.explanation.slice(0, 200)}`);
    return lines.join('\n');
  }

  private buildInlineKeyboard(s: SignalPayload): any[][] | null {
    const buttons: any[][] = [];
    const executeUrl = `${process.env.NEXT_PUBLIC_API_URL || ''}/api/execution/one-click?symbol=${encodeURIComponent(s.symbol)}&side=${s.signal}`;
    buttons.push([{ text: '⚡ Exécuter (1-clic)', url: executeUrl }]);
    buttons.push([{ text: '📈 Voir le graphique', url: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s.symbol.replace('/', ''))}` }]);
    return buttons;
  }
}

@Injectable()
export class DiscordDispatcher {
  private readonly logger = new Logger(DiscordDispatcher.name);

  async sendToWebhook(webhookUrl: string, signal: SignalPayload): Promise<boolean> {
    if (!webhookUrl) {
      this.logger.warn('Discord webhook URL empty — skipping');
      return false;
    }

    const embed = this.buildEmbed(signal);

    try {
      await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 5000 });
      this.logger.log(`Signal sent to Discord webhook: ${signal.symbol}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Discord dispatch failed: ${err?.response?.data?.message || err?.message}`);
      return false;
    }
  }

  async sendToMultiple(webhookUrls: string[], signal: SignalPayload): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const url of webhookUrls) {
      const ok = await this.sendToWebhook(url, signal);
      if (ok) sent++;
      else failed++;
    }
    return { sent, failed };
  }

  private buildEmbed(s: SignalPayload) {
    const color = s.signal === 'BUY' ? 0x00ff00 : s.signal === 'SELL' ? 0xff0000 : 0x808080;
    const fields: any[] = [
      { name: 'Timeframe', value: s.timeframe, inline: true },
      { name: 'Confiance', value: `${s.confidence.toFixed(0)}%`, inline: true },
    ];
    if (s.entryPrice) fields.push({ name: 'Entrée', value: String(s.entryPrice), inline: true });
    if (s.stopLoss) fields.push({ name: 'Stop Loss', value: String(s.stopLoss), inline: true });
    if (s.takeProfit1) fields.push({ name: 'TP1', value: String(s.takeProfit1), inline: true });
    if (s.riskReward) fields.push({ name: 'R/R', value: s.riskReward.toFixed(2), inline: true });
    if (s.explanation) fields.push({ name: 'Analyse', value: s.explanation.slice(0, 1024) });

    return {
      title: `${s.signal === 'BUY' ? '🟢' : '🔴'} Signal ${s.signal} — ${s.symbol}`,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: s.strategy || 'Trading OS' },
    };
  }
}
