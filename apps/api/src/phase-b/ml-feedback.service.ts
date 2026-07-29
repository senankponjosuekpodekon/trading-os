import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSignalFeedbackDto } from './dto/signal-feedback.dto';

export interface FeedbackStats {
  averageGrade: number;
  feedbackCount: number;
  estimatedQuality: number;
}

export interface RecalculateAllResult {
  signalsUpdated: number;
  averageQuality: number;
}

export interface FeedbackSummary {
  totalFeedbacks: number;
  distinctSignals: number;
  distinctUsers: number;
  averageGrade: number;
}

@Injectable()
export class MlFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSignalFeedbackDto) {
    return await this.prisma.signalFeedback.create({
      data: { userId, signalId: dto.signalId, grade: dto.grade, comment: dto.comment, outcome: dto.outcome },
    });
  }

  async findBySignal(signalId: string) {
    return await this.prisma.signalFeedback.findMany({ where: { signalId }, orderBy: { createdAt: 'desc' } });
  }

  async computeSignalStats(signalId: string): Promise<FeedbackStats> {
    const db = (this.prisma as any).signalFeedback;
    const feedbacks = await db.findMany({ where: { signalId } });
    if (feedbacks.length === 0) return { averageGrade: 0, feedbackCount: 0, estimatedQuality: 0 };
    const avg = feedbacks.reduce((sum: number, f: any) => sum + f.grade, 0) / feedbacks.length;
    const outcomes = feedbacks.filter((f: any) => typeof f.outcome === 'number').map((f: any) => f.outcome as number);
    const avgOutcome = outcomes.length ? outcomes.reduce((a, b) => a + b, 0) / outcomes.length : 0;
    const estimatedQuality = Math.min(100, Math.round((avg / 5) * 100 + avgOutcome * 10));
    return { averageGrade: parseFloat(avg.toFixed(2)), feedbackCount: feedbacks.length, estimatedQuality };
  }

  async getLeaderboard(limit = 20) {
    const rows = await this.prisma.signalFeedback.groupBy({ by: ['userId'], _count: { userId: true }, _avg: { grade: true }, orderBy: { _count: { userId: 'desc' } }, take: limit });
    return rows.map((row: any) => ({
      userId: row.userId,
      feedbacks: row._count.userId,
      averageGrade: parseFloat((row._avg.grade ?? 0).toFixed(2)),
    }));
  }

  async updateSignalQuality(signalId: string) {
    const stats = await this.computeSignalStats(signalId);
    await this.prisma.signal.update({ where: { id: signalId }, data: { qualityScore: stats.estimatedQuality } });
    return stats;
  }

  async recalculateAll(): Promise<RecalculateAllResult> {
    const grouped = await this.prisma.signalFeedback.groupBy({ by: ['signalId'] });
    const signalIds = grouped.map((g: any) => g.signalId as string);
    let sumQuality = 0;
    let updated = 0;
    for (const signalId of signalIds) {
      const stats = await this.updateSignalQuality(signalId);
      sumQuality += stats.estimatedQuality;
      updated += 1;
    }
    return {
      signalsUpdated: updated,
      averageQuality: updated > 0 ? parseFloat((sumQuality / updated).toFixed(2)) : 0,
    };
  }

  async getSummary(): Promise<FeedbackSummary> {
    const [total, bySignal, byUser, avg] = await Promise.all([
      this.prisma.signalFeedback.count(),
      this.prisma.signalFeedback.groupBy({ by: ['signalId'] }),
      this.prisma.signalFeedback.groupBy({ by: ['userId'] }),
      this.prisma.signalFeedback.aggregate({ _avg: { grade: true } }),
    ]);
    return {
      totalFeedbacks: total,
      distinctSignals: bySignal.length,
      distinctUsers: byUser.length,
      averageGrade: parseFloat(((avg as any)._avg?.grade ?? 0).toFixed(2)),
    };
  }
}
