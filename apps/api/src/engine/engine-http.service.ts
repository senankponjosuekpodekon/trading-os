import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { retryWithBackoff } from '../utils/retry';
import { CircuitBreaker, CircuitState } from '../utils/circuit-breaker';

@Injectable()
export class EngineHttpService {
  private readonly logger = new Logger(EngineHttpService.name);
  private readonly engineUrl: string;
  private readonly defaultTimeout = 10_000;

  private readonly engineApiKey: string;
  private readonly circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30_000,
  });

  constructor(
    private http: HttpService,
    config: ConfigService,
  ) {
    this.engineUrl = config.get<string>('ENGINE_URL', 'http://localhost:8000');
    this.engineApiKey = config.get<string>('ENGINE_API_KEY', '');
  }

  get url(): string {
    return this.engineUrl;
  }

  private get headers(): Record<string, string> {
    return this.engineApiKey ? { 'X-Engine-Key': this.engineApiKey } : {};
  }

  async get<T = any>(path: string, opts?: { params?: Record<string, any>; timeout?: number }): Promise<T> {
    const timeout = opts?.timeout ?? this.defaultTimeout;
    return this.circuitBreaker.execute(async () => {
      return retryWithBackoff(
        async () => {
          const { data } = await firstValueFrom(
            this.http.get<T>(`${this.engineUrl}${path}`, { params: opts?.params, timeout, headers: this.headers }),
          );
          return data;
        },
        {
          maxRetries: 2,
          baseDelayMs: 500,
          onRetry: (attempt, err) =>
            this.logger.warn(`Engine GET ${path} retry ${attempt} — ${err.message}`),
        },
      );
    });
  }

  async post<T = any>(path: string, body?: any, opts?: { params?: Record<string, any>; timeout?: number; maxRetries?: number }): Promise<T> {
    const timeout = opts?.timeout ?? this.defaultTimeout;
    return this.circuitBreaker.execute(async () => {
      return retryWithBackoff(
        async () => {
          const { data } = await firstValueFrom(
            this.http.post<T>(`${this.engineUrl}${path}`, body, { params: opts?.params, timeout, headers: this.headers }),
          );
          return data;
        },
        {
          maxRetries: opts?.maxRetries ?? 2,
          baseDelayMs: 500,
          onRetry: (attempt, err) =>
            this.logger.warn(`Engine POST ${path} retry ${attempt} — ${err.message}`),
        },
      );
    });
  }

  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  resetCircuit(): void {
    this.circuitBreaker.reset();
  }
}
