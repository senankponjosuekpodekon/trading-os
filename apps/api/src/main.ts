import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { auditEnv } from './common/security/env-audit';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';

async function bootstrap() {
  const sentryDsn = process.env.SENTRY_DSN_API;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.GIT_SHA,
    });
  }

  const app = await NestFactory.create(AppModule);

  // ── Sécurité HTTP headers ────────────────────────────────────────────
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
  }));

  // ── CORS strict ────────────────────────────────────────────────
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://169.58.80.46:3000,http://localhost:3000,http://localhost:3001')
    .split(',')
    .map(o => o.trim());

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods:            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders:     ['Content-Type', 'Authorization'],
    credentials:        true,
    maxAge:             86400,
  });

  // ── Validation globale ───────────────────────────────────────────
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist:        true,
    forbidNonWhitelisted: true,
    transform:        true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // ── Request ID for tracing ────────────────────────────────────────────
  app.use((req: any, _res: any, next: any) => {
    req.requestId = req.headers['x-request-id'] || randomUUID();
    next();
  });

  // ── Security env audit ─────────────────────────────────────────────
  auditEnv(new Logger('SecurityAudit'));

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  console.log(`Trading OS API running on port ${port} [${process.env.NODE_ENV ?? 'development'}]`);
}

bootstrap();
