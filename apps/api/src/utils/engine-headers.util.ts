import { ConfigService } from '@nestjs/config';

/**
 * Returns the X-Engine-Key header for engine HTTP calls.
 * Used by services that call the engine directly (not via EngineHttpService).
 */
export function engineHeaders(config: ConfigService): Record<string, string> {
  const key = config.get<string>('ENGINE_API_KEY', '');
  return key ? { 'X-Engine-Key': key } : {};
}
