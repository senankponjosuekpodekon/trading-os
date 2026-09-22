import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { SignalTrackerService } from './signal-tracker.service';
import { CronConfigService } from '../admin/cron-config.service';

@Injectable()
export class SignalTrackerScheduler {
  private _running = false;
  private _lastRunAt = 0;
  private static readonly MIN_INTERVAL_MS = 60_000;

  constructor(
    private readonly tracker: SignalTrackerService,
    private readonly config: ConfigService,
    private readonly cronConfig: CronConfigService,
  ) {}

  private _isEnabled(key: string): boolean {
    return this.config.get<string>(key, 'true').toLowerCase().match(/^(1|true|yes|on)$/) !== null;
  }

  private async _run(name: string, fn: () => Promise<void>): Promise<void> {
    if (this._running) return;
    const enabled = await this.cronConfig.isEnabled(name);
    if (!enabled) return;

    this._running = true;
    try {
      await fn();
      await this.cronConfig.setLastRun(name);
    } catch (error) {
      await this.cronConfig.setLastError(name, (error as Error)?.message ?? 'Unknown error');
      throw error;
    } finally {
      this._running = false;
    }
  }

  @OnEvent('candle.closed')
  async onCandleClosed(): Promise<void> {
    const now = Date.now();
    if (now - this._lastRunAt < SignalTrackerScheduler.MIN_INTERVAL_MS) return;
    this._lastRunAt = now;
    await this._run('SIGNAL_TRACKER_ENABLED', () => this.tracker.processActiveSignals());
  }

  @Cron('*/15 * * * *')
  async reconcile(): Promise<void> {
    await this._run('SIGNAL_TRACKER_ENABLED', () => this.tracker.processActiveSignals());
  }
}
