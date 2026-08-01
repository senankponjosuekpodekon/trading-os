import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { SignalPredictorService } from './signal-predictor.service';

describe('SignalPredictorService', () => {
  let service: SignalPredictorService;

  const postMock = jest.fn();
  const getMock = jest.fn();
  const mockHttp = {
    post: postMock,
    get: getMock,
  } as unknown as HttpService;

  const mockConfig = {
    get: jest.fn((key: string, def: any) => {
      if (key === 'ENGINE_URL') return 'http://engine:8000';
      return def;
    }),
  } as unknown as ConfigService;

  beforeEach(async () => {
    postMock.mockReset();
    getMock.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalPredictorService,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<SignalPredictorService>(SignalPredictorService);
  });

  describe('train', () => {
    it('should POST to engine ml/train', async () => {
      (mockHttp.post as any).mockReturnValue(of({ data: { trained: true } }));

      const result = await service.train('CRYPTO', '1h', 500);

      expect(mockHttp.post).toHaveBeenCalledWith('http://engine:8000/ml/train', {
        market: 'CRYPTO',
        timeframe: '1h',
        limit: 500,
      }, { headers: expect.any(Object) });
      expect(result).toEqual({ trained: true });
    });

    it('should bubble up errors from engine', async () => {
      (mockHttp.post as any).mockReturnValue(throwError(() => new Error('boom')));

      await expect(service.train()).rejects.toThrow('boom');
    });
  });

  describe('predict', () => {
    it('should POST features to engine ml/predict', async () => {
      (mockHttp.post as any).mockReturnValue(of({ data: { probability: 0.7 } }));

      const features = { confidence: 80, scoreTotal: 75 } as any;
      const result = await service.predict(features);

      expect(mockHttp.post).toHaveBeenCalledWith('http://engine:8000/ml/predict', { features }, { headers: expect.any(Object) });
      expect(result.probability).toBe(0.7);
    });
  });

  describe('status/weights', () => {
    it('should GET /ml/status for both status and weights', async () => {
      (mockHttp.get as any).mockReturnValue(of({ data: { trained: true } }));

      const status = await service.getStatus();
      const weights = await service.getFeatureWeights();

      expect(status.trained).toBe(true);
      expect(weights.trained).toBe(true);
      expect(mockHttp.get).toHaveBeenCalledTimes(2);
      expect(mockHttp.get).toHaveBeenCalledWith('http://engine:8000/ml/status', { headers: expect.any(Object) });
    });
  });
});
