import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { RegimeClassifierService } from './regime-classifier.service';

describe('RegimeClassifierService', () => {
  let service: RegimeClassifierService;

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
        RegimeClassifierService,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<RegimeClassifierService>(RegimeClassifierService);
  });

  describe('train', () => {
    it('should POST prices to engine ml/regime/train', async () => {
      (mockHttp.post as any).mockReturnValue(of({ data: { regime: 'bull' } }));

      const result = await service.train([1, 2, 3]);

      expect(mockHttp.post).toHaveBeenCalledWith('http://engine:8000/ml/regime/train', { prices: [1, 2, 3] }, { headers: expect.any(Object) });
      expect(result).toEqual({ regime: 'bull' });
    });

    it('should bubble up POST errors', async () => {
      (mockHttp.post as any).mockReturnValue(throwError(() => new Error('boom')));

      await expect(service.train([1, 2, 3])).rejects.toThrow('boom');
    });
  });

  describe('predict', () => {
    it('should POST prices to engine ml/regime/predict', async () => {
      (mockHttp.post as any).mockReturnValue(of({ data: { regime: 'bear' } }));

      const result = await service.predict([1, 2, 3]);

      expect(mockHttp.post).toHaveBeenCalledWith('http://engine:8000/ml/regime/predict', { prices: [1, 2, 3] }, { headers: expect.any(Object) });
      expect(result).toEqual({ regime: 'bear' });
    });

    it('should bubble up POST errors', async () => {
      (mockHttp.post as any).mockReturnValue(throwError(() => new Error('boom')));

      await expect(service.predict([1, 2, 3])).rejects.toThrow('boom');
    });
  });

  describe('status', () => {
    it('should GET engine ml/regime/status', async () => {
      (mockHttp.get as any).mockReturnValue(of({ data: { ok: true } }));

      const result = await service.status();

      expect(mockHttp.get).toHaveBeenCalledWith('http://engine:8000/ml/regime/status', { headers: expect.any(Object) });
      expect(result).toEqual({ ok: true });
    });

    it('should bubble up GET errors', async () => {
      (mockHttp.get as any).mockReturnValue(throwError(() => new Error('boom')));

      await expect(service.status()).rejects.toThrow('boom');
    });
  });
});
