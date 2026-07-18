import { HttpException } from '@nestjs/common';
import { ErrorCode, HTTP_STATUS_BY_CODE } from './error-codes';

/**
 * Domain exception carrying an internal error code.
 *
 * Benefits:
 * - Consistent response shape for clients
 * - Observability / alerting by error code
 * - No stack leak in production
 */
export class ApplicationException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, any>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, any>,
  ) {
    super(
      {
        statusCode: HTTP_STATUS_BY_CODE[code] ?? 500,
        code,
        message,
        ...(details ? { details } : {}),
      },
      HTTP_STATUS_BY_CODE[code] ?? 500,
    );
    this.code = code;
    this.details = details;
  }
}
