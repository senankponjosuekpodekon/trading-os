import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard for internal endpoints called by the engine (e.g. signal ingest).
 * Validates the X-Engine-Key header against ENGINE_API_KEY.
 */
@Injectable()
export class EngineKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-engine-key'];
    const expected = this.config.get<string>('ENGINE_API_KEY', '');
    if (!expected || key !== expected) {
      throw new UnauthorizedException('Invalid engine key');
    }
    return true;
  }
}
