import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { MetricsController } from './metrics.controller';

const mockMetrics = { render: jest.fn().mockReturnValue('# metrics') };
const mockRes = () => ({ set: jest.fn(), send: jest.fn() });

describe('MetricsController — fail closed', () => {
  it('refuse tout accès si METRICS_TOKEN non configuré', () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const controller = new MetricsController(mockMetrics as any, config as any);

    expect(() => controller.metrics(mockRes() as any, 'Bearer whatever')).toThrow(ServiceUnavailableException);
    expect(() => controller.metrics(mockRes() as any, undefined)).toThrow(ServiceUnavailableException);
    expect(mockMetrics.render).not.toHaveBeenCalled();
  });

  it('rejette un mauvais token', () => {
    const config = { get: jest.fn().mockReturnValue('s3cret') };
    const controller = new MetricsController(mockMetrics as any, config as any);

    expect(() => controller.metrics(mockRes() as any, 'Bearer wrong')).toThrow(UnauthorizedException);
    expect(() => controller.metrics(mockRes() as any, undefined)).toThrow(UnauthorizedException);
  });

  it('sert les métriques avec le bon token', () => {
    const config = { get: jest.fn().mockReturnValue('s3cret') };
    const controller = new MetricsController(mockMetrics as any, config as any);
    const res = mockRes();

    controller.metrics(res as any, 'Bearer s3cret');

    expect(mockMetrics.render).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('# metrics');
  });
});
