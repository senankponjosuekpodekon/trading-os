import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface CronConfig {
  name: string;
  enabled: boolean;
  description: string;
  lastRun?: Date;
  lastError?: string;
}

@Injectable()
export class CronConfigService {
  private redis: Redis;

  constructor(private config: ConfigService) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL', 'redis://localhost:6379'));
  }

  private key(name: string): string {
    return `cron:enabled:${name}`;
  }

  private lastRunKey(name: string): string {
    return `cron:lastRun:${name}`;
  }

  private lastErrorKey(name: string): string {
    return `cron:lastError:${name}`;
  }

  async isEnabled(name: string): Promise<boolean> {
    const value = await this.redis.get(this.key(name));
    if (value === null) return true; // default enabled
    return value === 'true';
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await this.redis.set(this.key(name), enabled ? 'true' : 'false');
  }

  async setLastRun(name: string): Promise<void> {
    await this.redis.set(this.lastRunKey(name), new Date().toISOString());
  }

  async setLastError(name: string, error: string): Promise<void> {
    await this.redis.set(this.lastErrorKey(name), error);
  }

  async getAll(): Promise<CronConfig[]> {
    const names = [
      { name: 'TRAILING_STOPS_ENABLED', description: 'Synchronisation des trailing stops (30s)' },
      { name: 'WATCHER_POSITIONS_ENABLED', description: 'Watcher positions (5 min)' },
      { name: 'WATCHER_PENDING_SIGNALS_ENABLED', description: 'Watcher signaux pending (5 min)' },
      { name: 'WATCHER_PENDING_POSITIONS_ENABLED', description: 'Watcher positions pending (10 min)' },
      { name: 'SIGNAL_OUTCOME_ENABLED', description: 'Résolution des outcomes (1h)' },
      { name: 'SYSTEM_HEALTH_ENABLED', description: 'Health checks (15 min)' },
      { name: 'SIGNALS_MORNING_SCAN_ENABLED', description: 'Scan matinal (6h UTC)' },
      { name: 'SIGNALS_DAY_SCAN_ENABLED', description: 'Scan 4h' },
      { name: 'SIGNALS_PREDICTOR_TRAINING_ENABLED', description: 'Training predictor (6h)' },
      { name: 'SIGNALS_PATTERN_PREDICTOR_ENABLED', description: 'Training pattern predictor (6h)' },
      { name: 'SIGNAL_TRACKER_ENABLED', description: 'Tracking des signaux (15 min)' },
      { name: 'REPORTS_ENABLED', description: 'Rapport journalier (6h UTC)' },
    ];

    const configs: CronConfig[] = [];
    for (const { name, description } of names) {
      const lastRun = await this.redis.get(this.lastRunKey(name));
      const lastError = await this.redis.get(this.lastErrorKey(name));
      configs.push({
        name,
        enabled: await this.isEnabled(name),
        description,
        lastRun: lastRun ? new Date(lastRun) : undefined,
        lastError: lastError ?? undefined,
      });
    }
    return configs;
  }
}
