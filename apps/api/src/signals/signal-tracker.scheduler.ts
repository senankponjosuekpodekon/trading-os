import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { SignalTrackerService } from './signal-tracker.service';

@Injectable()
export class SignalTrackerScheduler {
  constructor(
    private readonly tracker: SignalTrackerService,
    private readonly config: ConfigService,
  ) {}

  private _isEnabled(key: string): boolean {
    return this.config.get<string>(key, 'true').toLowerCase().match(/^(1|true|yes|on)$/) !== null;
  }

  @OnEvent('candle.closed')
  async onCandleClosed(): Promise<void> {
    if (!this._isEnabled('SIGNAL_TRACKER_ENABLED')) return;
    await this.tracker.processActiveSignals();
  }

  @Cron('*/15 * * * *')
  async reconcile(): Promise<void> {
    if (!this._isEnabled('SIGNAL_TRACKER_ENABLED')) return;
    await this.tracker.processActiveSignals();
  }
}
