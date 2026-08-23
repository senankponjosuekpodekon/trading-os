import { AxiosError } from 'axios';
import { handleApiError } from './api';

describe('handleApiError', () => {
  it('extracts server message from AxiosError', () => {
    const err = new AxiosError(
      'Network Error',
      'ERR_NETWORK',
      undefined,
      undefined,
      {
        status: 500,
        data: { message: 'Internal server error' },
      } as any,
    );

    const result = handleApiError(err);
    expect(result.status).toBe(500);
    expect(result.message).toBe('Internal server error');
    expect(result.code).toBe('ERR_NETWORK');
  });

  it('falls back to error message for generic Error', () => {
    const result = handleApiError(new Error('boom'));
    expect(result.status).toBe(0);
    expect(result.message).toBe('boom');
    expect(result.code).toBe('UNKNOWN');
  });
});
