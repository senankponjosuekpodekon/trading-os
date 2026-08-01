import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntryInput {
  userId: string;
  action: string;
  resource: string;
  details?: Record<string, any>;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(input: AuditEntryInput) {
    try {
      return await (this.prisma as any).auditLog.create({
        data: {
          userId: input.userId,
          action: input.action,
          resource: input.resource,
          details: input.details || undefined,
        },
      });
    } catch (e: any) {
      // Audit is best-effort; never break the main flow.
      Logger.warn(`Audit log failed: ${e?.message ?? e}`, 'AuditService');
    }
  }

  async findByUser(userId: string, opts: { page: number; limit: number } = { page: 1, limit: 50 }) {
    const skip = (opts.page - 1) * opts.limit;
    const db = (this.prisma as any).auditLog;
    const [data, total] = await Promise.all([
      db.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: opts.limit,
      }),
      db.count({ where: { userId } }),
    ]);
    return {
      data,
      meta: { page: opts.page, limit: opts.limit, total, totalPages: Math.ceil(total / opts.limit) },
    };
  }

  async findAll(opts: { page: number; limit: number; userId?: string; action?: string } = { page: 1, limit: 50 }) {
    const skip = (opts.page - 1) * opts.limit;
    const where: any = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.action) where.action = { contains: opts.action, mode: 'insensitive' };
    const db = (this.prisma as any).auditLog;
    const [data, total] = await Promise.all([
      db.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: opts.limit,
        include: { user: { select: { id: true, email: true, name: true, role: true } } },
      }),
      db.count({ where }),
    ]);
    return {
      data,
      meta: { page: opts.page, limit: opts.limit, total, totalPages: Math.ceil(total / opts.limit) },
    };
  }
}
