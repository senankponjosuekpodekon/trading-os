import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { ExpectedMoveService } from './expected-move.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('ExpectedMoveService', () => {
  let service: ExpectedMoveService;

  const mockHttp = {
    get: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue('http://engine.local'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockHttp.get.mockReturnValue(of({ data: { symbol: 'BTC/USDT' } }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpectedMoveService,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ExpectedMoveService>(ExpectedMoveService);
  });

  it('calls engine endpoint with encoded symbol and params', async () => {
    const payload = { symbol: 'BTC/USDT', ranges: [] };
    mockHttp.get.mockReturnValue(of({ data: payload }));

    const result = await service.getExpectedMove('BTC/USDT', '1h', [5, 10], 320);

    expect(result).toEqual(payload);
    expect(mockHttp.get).toHaveBeenCalledWith(
      'http://engine.local/expected-move/BTC%2FUSDT',
      { params: { timeframe: '1h', limit: 320, horizons: '5,10' } },
    );
  });

  it('throws ServiceUnavailableException when engine call fails', async () => {
    mockHttp.get.mockReturnValue(throwError(() => new Error('boom')));

    await expect(service.getExpectedMove('BTC/USDT')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('caches responses for identical parameters', async () => {
    const payload = { symbol: 'BTC/USDT', ranges: [{ horizon: 5 }] };
    mockHttp.get.mockReturnValueOnce(of({ data: payload }));

    const first = await service.getExpectedMove('BTC/USDT', '1h');
    const second = await service.getExpectedMove('BTC/USDT', '1h');

    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });
});
