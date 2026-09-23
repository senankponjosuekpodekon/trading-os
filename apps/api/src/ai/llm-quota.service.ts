import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Quota journalier de messages IA par utilisateur (clés `llm:quota:{userId}:{YYYY-MM-DD}`).
 * ADMIN/SUPER_ADMIN : illimité. Compteur = messages, pas tokens — mesure simple
 * et suffisante tant que Groq/Ollama sont gratuits.
 */
@Injectable()
export class LlmQuotaService {
  private readonly logger = new Logger(LlmQuotaService.name);
  private redis: Redis;

  constructor(private config: ConfigService) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL', 'redis://localhost:6379'));
  }

  get dailyLimit(): number {
    return this.config.get<number>('LLM_DAILY_QUOTA', 30);
  }

  private key(userId: string): string {
    const day = new Date().toISOString().slice(0, 10);
    return `llm:quota:${userId}:${day}`;
  }

  async checkAndConsume(userId: string, role?: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      return { allowed: true, remaining: -1, limit: -1 };
    }
    try {
      const count = await this.redis.incr(this.key(userId));
      if (count === 1) {
        // expire 25h — couvre la journée même si créé à 00:00 pile
        await this.redis.expire(this.key(userId), 90_000);
      }
      const limit = this.dailyLimit;
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
    } catch (err) {
      // Redis down → ne pas bloquer l'IA pour un problème de quota
      this.logger.warn(`llm quota check failed: ${(err as Error)?.message}`);
      return { allowed: true, remaining: -1, limit: this.dailyLimit };
    }
  }

  async getUsage(userId: string, role?: string): Promise<{ used: number; remaining: number; limit: number }> {
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      return { used: 0, remaining: -1, limit: -1 };
    }
    const limit = this.dailyLimit;
    try {
      const raw = await this.redis.get(this.key(userId));
      const used = raw ? parseInt(raw, 10) : 0;
      return { used, remaining: Math.max(0, limit - used), limit };
    } catch {
      return { used: 0, remaining: limit, limit };
    }
  }
}
