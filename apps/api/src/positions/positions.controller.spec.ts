import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { CrossPositionRiskService } from './cross-position-risk.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('PositionsController', () => {
  let controller: PositionsController;

  const mockPositionsService = {
    create: jest.fn(),
    openFromSignal: jest.fn(),
    checkGate: jest.fn(),
    findByPortfolio: jest.fn(),
    getLivePositions: jest.fn(),
    getSummary: jest.fn(),
    close: jest.fn(),
    setTrailingStop: jest.fn(),
    continuationAdvice: jest.fn(),
    pyramid: jest.fn(),
  };

  const mockCrossRisk = {
    getCorrelationReport: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PositionsController],
      providers: [
        { provide: PositionsService, useValue: mockPositionsService },
        { provide: CrossPositionRiskService, useValue: mockCrossRisk },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (): boolean => true } as CanActivate)
      .compile();

    controller = module.get<PositionsController>(PositionsController);
  });

  it('create', async () => {
    mockPositionsService.create.mockResolvedValue({ id: 'p1' });
    const result = await controller.create({ user: { id: 'u1' } }, { symbol: 'BTC/USDT', quantity: 1 } as any);
    expect(mockPositionsService.create).toHaveBeenCalledWith('u1', { symbol: 'BTC/USDT', quantity: 1 });
    expect(result).toEqual({ id: 'p1' });
  });

  it('openFromSignal', async () => {
    mockPositionsService.openFromSignal.mockResolvedValue({ id: 'p1' });
    const result = await controller.openFromSignal({ user: { id: 'u1' } }, 'sig1', 'LIVE', 100);
    expect(mockPositionsService.openFromSignal).toHaveBeenCalledWith('u1', 'sig1', 'LIVE', 100);
    expect(result).toEqual({ id: 'p1' });
  });

  it('openFromSignal defaults to PAPER', async () => {
    mockPositionsService.openFromSignal.mockResolvedValue({ id: 'p1' });
    const result = await controller.openFromSignal({ user: { id: 'u1' } }, 'sig1');
    expect(mockPositionsService.openFromSignal).toHaveBeenCalledWith('u1', 'sig1', 'PAPER', undefined);
    expect(result).toEqual({ id: 'p1' });
  });

  it('checkGate with price', async () => {
    mockPositionsService.checkGate.mockResolvedValue({ ok: true });
    const result = await controller.checkGate({ user: { id: 'u1' } }, 'sig1', '105.5');
    expect(mockPositionsService.checkGate).toHaveBeenCalledWith('sig1', 105.5);
    expect(result).toEqual({ ok: true });
  });

  it('checkGate without price', async () => {
    mockPositionsService.checkGate.mockResolvedValue({ ok: true });
    const result = await controller.checkGate({ user: { id: 'u1' } }, 'sig1');
    expect(mockPositionsService.checkGate).toHaveBeenCalledWith('sig1', undefined);
    expect(result).toEqual({ ok: true });
  });

  it('findByPortfolio', async () => {
    mockPositionsService.findByPortfolio.mockResolvedValue({ items: [] });
    const result = await controller.findByPortfolio(
      { user: { id: 'u1' } }, 'pf1', '2', '50', 'openedAt:asc', 'OPEN',
    );
    expect(mockPositionsService.findByPortfolio).toHaveBeenCalledWith('u1', 'pf1', {
      page: 2, limit: 50, sort: 'openedAt:asc', status: 'OPEN',
    });
    expect(result).toEqual({ items: [] });
  });

  it('getLive', async () => {
    mockPositionsService.getLivePositions.mockResolvedValue([]);
    const result = await controller.getLive({ user: { id: 'u1' } }, 'pf1');
    expect(mockPositionsService.getLivePositions).toHaveBeenCalledWith('u1', 'pf1');
    expect(result).toEqual([]);
  });

  it('getSummary', async () => {
    mockPositionsService.getSummary.mockResolvedValue({ pnl: 0 });
    const result = await controller.getSummary({ user: { id: 'u1' } }, 'pf1');
    expect(mockPositionsService.getSummary).toHaveBeenCalledWith('u1', 'pf1');
    expect(result).toEqual({ pnl: 0 });
  });

  it('getCorrelationReport', async () => {
    mockCrossRisk.getCorrelationReport.mockResolvedValue({ clusters: {} });
    const result = await controller.getCorrelationReport({ user: { id: 'u1' } }, 'pf1');
    expect(mockCrossRisk.getCorrelationReport).toHaveBeenCalledWith('pf1');
    expect(result).toEqual({ clusters: {} });
  });

  it('close', async () => {
    mockPositionsService.close.mockResolvedValue({ id: 'p1' });
    const result = await controller.close({ user: { id: 'u1' } }, 'p1', 100);
    expect(mockPositionsService.close).toHaveBeenCalledWith('u1', 'p1', 100);
    expect(result).toEqual({ id: 'p1' });
  });

  it('updateTrailingStop', async () => {
    mockPositionsService.setTrailingStop.mockResolvedValue({ id: 'p1' });
    const result = await controller.updateTrailingStop({ user: { id: 'u1' } }, 'p1', { activation: 10 } as any);
    expect(mockPositionsService.setTrailingStop).toHaveBeenCalledWith('u1', 'p1', { activation: 10 });
    expect(result).toEqual({ id: 'p1' });
  });

  it('continuationAdvice', async () => {
    mockPositionsService.continuationAdvice.mockResolvedValue({ advice: 'hold' });
    const result = await controller.continuationAdvice({ user: { id: 'u1' } }, 'p1', 100);
    expect(mockPositionsService.continuationAdvice).toHaveBeenCalledWith('u1', 'p1', 100);
    expect(result).toEqual({ advice: 'hold' });
  });

  it('pyramid', async () => {
    mockPositionsService.pyramid.mockResolvedValue({ id: 'p1' });
    const result = await controller.pyramid({ user: { id: 'u1' } }, 'p1');
    expect(mockPositionsService.pyramid).toHaveBeenCalledWith('u1', 'p1');
    expect(result).toEqual({ id: 'p1' });
  });
});
