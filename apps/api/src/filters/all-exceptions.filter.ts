import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApplicationException } from '../common/errors/application.exception';
import { ErrorCode } from '../common/errors/error-codes';
import * as Sentry from '@sentry/node';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly SENSITIVE_KEYS = new Set(['password', 'token', 'totptoken', 'refresh_token', 'authorization', 'secret']);

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (this.SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isProd = process.env.NODE_ENV === 'production';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    let details: Record<string, any> | undefined;

    if (exception instanceof ApplicationException) {
      status = exception.getStatus();
      const res = exception.getResponse() as any;
      message = res.message || message;
      code = exception.code;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message || message;
    } else if (exception instanceof Error) {
      message = isProd ? 'Internal server error' : exception.message;
    }

    const errorPayload = {
      status,
      code,
      path: request.url,
      method: request.method,
      userId: (request as any).user?.id,
      body: this.sanitizeBody(request.body),
      error: exception instanceof Error ? exception.message : String(exception),
      stack: isProd ? undefined : exception instanceof Error ? exception.stack : undefined,
      details,
    };

    this.logger.error(errorPayload);

    if (Sentry.getCurrentHub().getClient()) {
      Sentry.captureException(exception instanceof Error ? exception : new Error(String(exception)), {
        tags: { module: 'api' },
        extra: errorPayload,
      });
    }

    const responseBody: Record<string, any> = {
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: (request as any).requestId,
    };

    if (details) {
      responseBody.details = details;
    }

    if (!isProd && exception instanceof Error) {
      responseBody.error = exception.message;
      if (exception.stack) responseBody.stack = exception.stack;
    }

    response.status(status).json(responseBody);
  }
}
