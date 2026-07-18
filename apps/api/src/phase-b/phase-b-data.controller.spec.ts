import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { throwError } from 'rxjs';
import { PhaseBDataController } from './phase-b-data.controller';
import { PhaseBDataService } from './phase-b-data.service';

describe('PhaseBDataController', () => {
  let controller: PhaseBDataController;

  const mockHttp = {
    // Engine unreachable -> service falls back to mock data
    get: jest.fn().mockReturnValue(throwError(() => new Error('ECONNREFUSED'))),
  };

  const mockConfig = {
    get: jest.fn().mockImplementation((_key: string, def?: string) => def),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhaseBDataController],
      providers: [
        PhaseBDataService,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    controller = module.get<PhaseBDataController>(PhaseBDataController);
  });

  it('returns tokenomics with optional asset filter', async () => {
    expect((await controller.tokenomics()).data).toHaveLength(2);
    expect((await controller.tokenomics('ETH')).data).toHaveLength(1);
    expect((await controller.tokenomics('ETH')).data[0].assetSymbol).toBe('ETH');
  });

  it('returns social sentiment with optional trending filter', async () => {
    expect((await controller.social()).data).toHaveLength(2);
    expect((await controller.social('true')).data).toHaveLength(1);
  });

  it('returns BRVM stocks with optional sector filter', async () => {
    expect((await controller.brvm()).data).toHaveLength(3);
    expect((await controller.brvm('Banque')).data).toHaveLength(1);
  });

  it('returns synthetic assets with optional underlying filter', async () => {
    expect((await controller.synthetic()).data).toHaveLength(2);
    expect((await controller.synthetic('BTC')).data).toHaveLength(1);
  });
});
