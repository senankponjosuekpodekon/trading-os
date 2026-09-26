import { Controller, Get, Headers, Res, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    private metricsService: MetricsService,
    private config: ConfigService,
  ) {}

  @Get()
  metrics(@Res() res: Response, @Headers('authorization') auth?: string) {
    const metricsToken = this.config.get<string>('METRICS_TOKEN');
    if (!metricsToken) {
      // Fail-closed : un /metrics sans token configuré exposerait les
      // métriques internes (routes, volumes) à n'importe qui.
      throw new ServiceUnavailableException('Metrics disabled: METRICS_TOKEN not configured');
    }
    const expected = `Bearer ${metricsToken}`;
    const valid = !!auth
      && auth.length === expected.length
      && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
    if (!valid) {
      throw new UnauthorizedException('Invalid metrics token');
    }
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(this.metricsService.render());
  }
}
