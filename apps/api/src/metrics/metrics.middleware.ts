import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const route = req.route ? req.route.path : req.path;

    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      this.metricsService.inc(`http:requests_total`);
      this.metricsService.inc(`http:requests_total:route:${route}`);
      this.metricsService.inc(`http:status:${status}`);
      this.metricsService.observe(`http:request_duration_ms`, duration);
    });

    next();
  }
}
