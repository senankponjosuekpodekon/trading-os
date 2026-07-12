import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
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
