import { ApplicationException } from './application.exception';
import { ErrorCode, HTTP_STATUS_BY_CODE } from './error-codes';


describe('ApplicationException', () => {
  it('creates an exception with code, message and status', () => {
    const exc = new ApplicationException(
      ErrorCode.AUTH_INVALID_CREDENTIALS,
      'Invalid email or password',
    );

    expect(exc.code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
    expect(exc.getStatus()).toBe(HTTP_STATUS_BY_CODE[ErrorCode.AUTH_INVALID_CREDENTIALS]);
    const res = exc.getResponse() as any;
    expect(res.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(res.message).toBe('Invalid email or password');
    expect(res.statusCode).toBe(401);
  });

  it('includes details in response', () => {
    const exc = new ApplicationException(
      ErrorCode.VALIDATION_ERROR,
      'Validation failed',
      { fields: ['email'] },
    );

    const res = exc.getResponse() as any;
    expect(res.details).toEqual({ fields: ['email'] });
    expect(exc.details).toEqual({ fields: ['email'] });
  });
});
