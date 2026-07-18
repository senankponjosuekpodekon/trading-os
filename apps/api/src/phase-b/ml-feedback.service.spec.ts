import { Test, TestingModule } from '@nestjs/testing';
import { MlFeedbackService } from './ml-feedback.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MlFeedbackService', () => {
  let service: MlFeedbackService;

  const mockSignalFeedback = {
    create: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  };

  const mockSignal = {
    update: jest.fn(),
  };

  const mockPrisma = {
    signalFeedback: mockSignalFeedback,
    signal: mockSignal,
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MlFeedbackService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<MlFeedbackService>(MlFeedbackService);
    jest.clearAllMocks();
  });

  it('creates feedback', async () => {
    mockSignalFeedback.create.mockResolvedValue({ id: 'f1' });
    const dto = { signalId: 's1', grade: 4, comment: 'good', outcome: 2.5 };
    const result = await service.create('u1', dto);
    expect(mockSignalFeedback.create).toHaveBeenCalledWith({
      data: { userId: 'u1', signalId: 's1', grade: 4, comment: 'good', outcome: 2.5 },
    });
    expect(result.id).toBe('f1');
  });

  it('computes stats and estimated quality', async () => {
    mockSignalFeedback.findMany.mockResolvedValue([
      { grade: 4, outcome: 2 },
      { grade: 5, outcome: 1 },
      { grade: 3 },
    ]);
    const stats = await service.computeSignalStats('s1');
    expect(stats.averageGrade).toBe(4);
    expect(stats.feedbackCount).toBe(3);
    expect(stats.estimatedQuality).toBeGreaterThan(0);
  });

  it('updates signal quality score', async () => {
    mockSignalFeedback.findMany.mockResolvedValue([{ grade: 5, outcome: 3 }]);
    await service.updateSignalQuality('s1');
    expect(mockSignal.update).toHaveBeenCalled();
    const data = mockSignal.update.mock.calls[0][0].data;
    expect(data.qualityScore).toBeGreaterThan(0);
  });

  it('recalculates quality for all signals with feedback', async () => {
    mockSignalFeedback.groupBy.mockResolvedValue([{ signalId: 's1' }, { signalId: 's2' }]);
    mockSignalFeedback.findMany.mockResolvedValue([{ grade: 4, outcome: 1 }]);
    const result = await service.recalculateAll();
    expect(result.signalsUpdated).toBe(2);
    expect(result.averageQuality).toBeGreaterThan(0);
    expect(mockSignal.update).toHaveBeenCalledTimes(2);
  });

  it('returns empty recalculation result when no feedback exists', async () => {
    mockSignalFeedback.groupBy.mockResolvedValue([]);
    const result = await service.recalculateAll();
    expect(result.signalsUpdated).toBe(0);
    expect(result.averageQuality).toBe(0);
    expect(mockSignal.update).not.toHaveBeenCalled();
  });

  it('returns global feedback summary', async () => {
    mockSignalFeedback.count.mockResolvedValue(5);
    mockSignalFeedback.groupBy
      .mockResolvedValueOnce([{ signalId: 's1' }, { signalId: 's2' }])
      .mockResolvedValueOnce([{ userId: 'u1' }]);
    mockSignalFeedback.aggregate.mockResolvedValue({ _avg: { grade: 4.2 } });
    const summary = await service.getSummary();
    expect(summary.totalFeedbacks).toBe(5);
    expect(summary.distinctSignals).toBe(2);
    expect(summary.distinctUsers).toBe(1);
    expect(summary.averageGrade).toBe(4.2);
  });
});
