import { ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  @Optional()
  @Inject(ConfigService)
  private readonly configService?: ConfigService;

  /**
   * Le trafic interne engine→API (header X-Engine-Key) n'est pas soumis au
   * quota. Les throttlers étant nommés (short/medium/long), @SkipThrottle()
   * ne couvre que le throttler "default" et ne fonctionne pas ici — le bypass
   * doit se faire via shouldSkip.
   */
  async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const engineKey = this.configService?.get<string>('ENGINE_API_KEY');
    if (engineKey) {
      const req = context.switchToHttp().getRequest<Request>();
      if (req.headers['x-engine-key'] === engineKey) {
        return true;
      }
    }
    return super.shouldSkip(context);
  }

  /**
   * Décode le JWT depuis le header Authorization pour obtenir userId.
   * Fallback sur l'IP si pas de token. La vérification de signature est
   * faite plus tard par JwtAuthGuard — ici on a juste besoin d'un tracker stable.
   */
  protected async getTracker(req: Request): Promise<string> {
    const token = this._extractToken(req);
    if (token) {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload && payload.sub) {
          return `user:${payload.sub}`;
        }
      } catch {
        // token malformé → fallback IP
      }
    }
    return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  }

  private _extractToken(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (!auth) return undefined;
    const [type, token] = auth.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
