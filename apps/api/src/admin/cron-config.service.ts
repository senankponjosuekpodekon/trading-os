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

  /**
   * Verrou distribué best-effort : quand plusieurs instances API tournent,
   * elles ne doivent pas exécuter le même cron en parallèle (doublons de
   * signaux, positions double-close, events dupliqués). Fail-open si Redis
   * est indisponible — un éventuel doublon vaut mieux qu'un cron mort.
   */
  private readonly lockOwner = `${process.pid}-${Math.random().toString(36).slice(2)}`;

  private lockKey(name: string): string {
    return `cron:lock:${name}`;
  }

  async acquireLock(name: string, ttlSeconds = 900): Promise<boolean> {
    try {
      const res = await this.redis.set(this.lockKey(name), this.lockOwner, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch {
      return true;
    }
  }

  async releaseLock(name: string): Promise<void> {
    try {
      // Ne supprime que si c'est bien notre lock (pas celui d'un autre
      // processus qui aurait pris la main après expiration du TTL)
      await this.redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        this.lockKey(name),
        this.lockOwner,
      );
    } catch {
      // best-effort — le TTL purge de toute façon
    }
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
