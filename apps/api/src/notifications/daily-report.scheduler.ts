import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaSystemService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AlertService } from './alert.service';

/**
 * Rapport quotidien — positions MT5 (démo), signaux du jour, autoexec.
 * Env :
 *   DAILY_REPORT_ENABLED=1  (requis — inerte sinon)
 *   DAILY_REPORT_HOUR=8     (heure UTC du rapport, défaut 8h)
 *   DAILY_REPORT_EMAIL=1    (envoie aussi par email aux users actifs)
 * Le push passe par broadcastPush → filtré par typePrefs 'daily_report'
 * si l'utilisateur l'ajoute (fail-open sinon).
 */
@Injectable()
export class DailyReportScheduler {
  private readonly logger = new Logger(DailyReportScheduler.name);

  constructor(
    private readonly prisma: PrismaSystemService,
    private readonly mail: MailService,
    private readonly alerts: AlertService,
  ) {}

  @Cron(process.env.DAILY_REPORT_CRON ?? '0 8 * * *')
  async run() {
    if (process.env.DAILY_REPORT_ENABLED !== '1') return;

    const lines: string[] = [];
    try {
      // ── MT5 démo : compte + positions ──
      const bridge = (process.env.MT5_BRIDGE_URL ?? '').replace(/\/$/, '');
      const token = process.env.MT5_BRIDGE_TOKEN ?? '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      if (bridge) {
        try {
          const [h, pos] = await Promise.all([
            axios.get(`${bridge}/health`, { headers, timeout: 20000 }),
            axios.get(`${bridge}/positions`, { headers, timeout: 20000 }),
          ]);
          const hd = h.data ?? {};
          lines.push(
            `MT5 ${hd.server ?? '?'} (${hd.account_mode ?? '?'}) — ` +
            `connecté: ${hd.connected ? 'oui' : 'NON'}, balance: ${hd.balance ?? '?'}`
          );
          const positions = Array.isArray(pos.data) ? pos.data : pos.data?.positions ?? [];
          if (positions.length) {
            lines.push(`${positions.length} position(s) ouverte(s) :`);
            for (const p of positions.slice(0, 10)) {
              lines.push(
                `  ${p.type === 0 ? 'BUY' : 'SELL'} ${p.symbol} ${p.volume} — P&L ${(p.profit ?? 0).toFixed(2)}`
              );
            }
          } else {
            lines.push('Aucune position ouverte.');
          }
        } catch (e: any) {
          lines.push(`MT5 bridge injoignable (${e?.message?.slice(0, 80)})`);
        }
      }

      // ── Signaux du jour ──
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const sigs = await this.prisma.signal.findMany({
        where: { createdAt: { gte: dayStart } },
        select: { signal: true, confidence: true, asset: { select: { symbol: true } } },
        orderBy: { confidence: 'desc' },
      });
      const buys = sigs.filter(s => s.signal === 'BUY').length;
      const sells = sigs.filter(s => s.signal === 'SELL').length;
      lines.push(`Signaux aujourd'hui : ${sigs.length} (${buys} BUY / ${sells} SELL)`);
      for (const s of sigs.slice(0, 5)) {
        lines.push(`  ${s.signal} ${s.asset.symbol} conf ${Math.round(s.confidence)}`);
      }
    } catch (e: any) {
      this.logger.error(`daily report build failed: ${e?.message}`);
      lines.push(`Rapport partiel — erreur: ${e?.message?.slice(0, 80)}`);
    }

    const body = lines.join('\n');
    const title = `📊 Rapport quotidien — ${new Date().toISOString().slice(0, 10)}`;

    try {
      await this.alerts.broadcastPush(title, body, { kind: 'daily_report' });
    } catch (e: any) {
      this.logger.error(`daily report push failed: ${e?.message}`);
    }

    if (process.env.DAILY_REPORT_EMAIL === '1') {
      try {
        const users = await this.prisma.user.findMany({
          where: {
            isActive: true,
            notificationPreference: { emailEnabled: true },
          },
          select: { email: true },
        });
        const sends = users.filter(u => u.email)
          .map(u => this.mail.send(u.email, title, body, body.replace(/\n/g, '<br>')));
        await Promise.allSettled(sends);
        this.logger.log(`daily report emailed to ${sends.length} user(s)`);
      } catch (e: any) {
        this.logger.error(`daily report email failed: ${e?.message}`);
      }
    }

    this.logger.log('daily report sent');
  }
}
