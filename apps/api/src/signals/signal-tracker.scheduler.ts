import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { SignalTrackerService } from './signal-tracker.service';
import { CronConfigService } from '../admin/cron-config.service';

@Injectable()
export class SignalTrackerScheduler {
  constructor(
    private readonly tracker: SignalTrackerService,
    private readonly config: ConfigService,
    private readonly cronConfig: CronConfigService,
  ) {}

  private _isEnabled(key: string): boolean {
    return this.config.get<string>(key, 'true').toLowerCase().match(/^(1|true|yes|on)$/) !== null;
  }

  private async _run(name: string, fn: () => Promise<void>): Promise<void> {
    const enabled = await this.cronConfig.isEnabled(name);
    if (!enabled) return;

    try {
      await fn();
      await this.cronConfig.setLastRun(name);
    } catch (error) {
      await this.cronConfig.setLastError(name, (error as Error)?.message ?? 'Unknown error');
      throw error;
    }
  }

  @OnEvent('candle.closed')
  async onCandleClosed(): Promise<void> {
    await this._run('SIGNAL_TRACKER_ENABLED', () => this.tracker.processActiveSignals());
  }

  @Cron('*/15 * * * *')
  async reconcile(): Promise<void> {
    await this._run('SIGNAL_TRACKER_ENABLED', () => this.tracker.processActiveSignals());
  }
}
