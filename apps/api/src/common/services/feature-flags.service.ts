import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const MAINTENANCE_FLAG = 'MAINTENANCE_MODE';
export const REGISTRATION_FLAG = 'REGISTRATION_ENABLED';

/**
 * Feature flags runtime persistés en Redis (clés `flag:*`).
 * Utilisés pour maintenance, activation d'inscriptions, etc.
 * L'état survit aux restarts — contrairement à un boolean en mémoire.
 */
@Injectable()
export class FeatureFlagsService {
  private redis: Redis;

  constructor(private config: ConfigService) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL', 'redis://localhost:6379'));
  }

  private flagKey(name: string): string {
    return `flag:${name}`;
  }

  async getFlag(name: string, defaultValue: boolean): Promise<boolean> {
    const value = await this.redis.get(this.flagKey(name));
    if (value === null) return defaultValue;
    return value === 'true';
  }

  async setFlag(name: string, value: boolean): Promise<void> {
    await this.redis.set(this.flagKey(name), value ? 'true' : 'false');
  }
}
