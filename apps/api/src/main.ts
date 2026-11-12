import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { auditEnv } from './common/security/env-audit';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import { PricesProxyService } from './prices-proxy/prices-proxy.service';

const logger = new Logger('Bootstrap');

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

  app.use(cookieParser());

  // ── Sécurité HTTP headers ────────────────────────────────────────────
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
  }));

  // ── CORS strict ────────────────────────────────────────────────
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001')
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

  // ── CSRF défense en profondeur ─────────────────────────────────────
  // Les cookies sont déjà sameSite=strict/lax ; on vérifie en plus que les
  // requêtes mutantes authentifiées par cookie proviennent d'une origine
  // autorisée (Origin ou Referer). Les clients non-navigateur (sans Origin)
  // passent — ils n'envoient de toute façon pas de cookies cross-site.
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  app.use((req: any, res: any, next: any) => {
    if (SAFE_METHODS.has(req.method) || !req.headers.cookie) return next();
    const source = req.headers.origin || req.headers.referer;
    if (!source) return next();
    try {
      if (allowedOrigins.includes(new URL(source).origin)) return next();
    } catch { /* malformed header → reject below */ }
    return res.status(403).json({ statusCode: 403, message: 'Forbidden origin', error: 'Forbidden' });
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
  if (!process.env.JWT_SECRET) {
    logger.error('[FATAL] JWT_SECRET is not set. Refusing to start.');
    process.exit(1);
  }
  auditEnv(new Logger('SecurityAudit'));

  const port = process.env.API_PORT || 3001;
  await app.listen(port);

  // ── Proxy WS /ws/prices + /ws/signals vers l'engine (interne, non exposé) ──
  app.get(PricesProxyService).attach(app.getHttpServer());

  logger.log(`Trading OS API running on port ${port} [${process.env.NODE_ENV ?? 'development'}]`);
}

bootstrap();
