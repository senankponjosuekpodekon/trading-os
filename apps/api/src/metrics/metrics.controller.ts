import { Controller, Get, Headers, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
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
    if (metricsToken) {
      if (auth !== `Bearer ${metricsToken}`) {
        throw new UnauthorizedException('Invalid metrics token');
      }
    }
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(this.metricsService.render());
  }
}
