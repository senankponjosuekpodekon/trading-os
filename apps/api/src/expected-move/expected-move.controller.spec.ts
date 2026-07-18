import { Test, TestingModule } from '@nestjs/testing';
import { ExpectedMoveController } from './expected-move.controller';
import { ExpectedMoveService } from './expected-move.service';

describe('ExpectedMoveController', () => {
  let controller: ExpectedMoveController;
  const mockService = {
    getExpectedMove: jest.fn().mockResolvedValue({ symbol: 'BTC/USDT' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpectedMoveController],
      providers: [
        { provide: ExpectedMoveService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<ExpectedMoveController>(ExpectedMoveController);
  });

  it('parses horizons and passes to service', async () => {
    await controller.getExpectedMove('BTC/USDT', '4h', '3, 6, 6', '200');
    expect(mockService.getExpectedMove).toHaveBeenCalledWith('BTC/USDT', '4h', [3, 6], 200);
  });

  it('uses defaults when horizons missing', async () => {
    await controller.getExpectedMove('BTC/USDT');
    expect(mockService.getExpectedMove).toHaveBeenCalledWith('BTC/USDT', '1h', [5, 10, 20], 400);
  });

  it('throws when symbol missing', async () => {
    await expect(controller.getExpectedMove(undefined as any)).rejects.toThrow('symbol is required');
  });
});
