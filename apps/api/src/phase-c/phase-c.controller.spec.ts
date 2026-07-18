import { Test, TestingModule } from '@nestjs/testing';
import { PhaseCController } from './phase-c.controller';

describe('PhaseCController', () => {
  let controller: PhaseCController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhaseCController],
    }).compile();
    controller = module.get<PhaseCController>(PhaseCController);
  });

  it('should return presales and filter by chain', () => {
    expect(controller.presales().data).toHaveLength(2);
    expect(controller.presales('ETH').data).toHaveLength(1);
    expect(controller.presales('ETH').data[0].symbol).toBe('NXM');
  });

  it('should return whale alerts and filter by asset/type', () => {
    expect(controller.whales().data).toHaveLength(2);
    expect(controller.whales('BTC').data).toHaveLength(1);
    expect(controller.whales(undefined, 'transfer').data).toHaveLength(1);
  });

  it('should return developer activity and filter by minScore', () => {
    expect(controller.devActivity().data).toHaveLength(3);
    expect(controller.devActivity('70').data).toHaveLength(2);
  });

  it('should return DeFi metrics and filter by chain', () => {
    expect(controller.defi().data).toHaveLength(3);
    expect(controller.defi('BSC').data).toHaveLength(1);
  });
});
