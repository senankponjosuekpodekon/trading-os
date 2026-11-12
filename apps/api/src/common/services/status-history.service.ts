import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface StatusChange {
  entityType: string;  // 'strategy' | 'asset_config' | 'user_strategy' | ...
  entityId: string;
  field: string;       // 'isActive' | 'isEnabled' | ...
  oldValue?: string | boolean | number | null;
  newValue?: string | boolean | number | null;
  changedBy?: string;  // userId ou 'system'
  reason?: string;
}

/**
 * Historique générique des changements de statut.
 * Utilisable par tout service pour tracer qui a activé/désactivé quoi et quand.
 */
@Injectable()
export class StatusHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  record(change: StatusChange): void {
    this.prisma.statusHistory
      .create({
        data: {
          entityType: change.entityType,
          entityId: change.entityId,
          field: change.field,
          oldValue: change.oldValue == null ? null : String(change.oldValue),
          newValue: change.newValue == null ? null : String(change.newValue),
          changedBy: change.changedBy ?? 'system',
          reason: change.reason,
        },
      })
      .catch(() => {}); // l'historique ne doit jamais casser l'opération principale
  }

  recordField<T extends { id: string }>(
    entityType: string,
    before: T | null,
    after: T,
    field: keyof T,
    changedBy?: string,
    reason?: string,
  ): void {
    const oldV = before?.[field];
    const newV = after[field];
    if (oldV === newV) return;
    this.record({
      entityType,
      entityId: after.id,
      field: String(field),
      oldValue: oldV as any,
      newValue: newV as any,
      changedBy,
      reason,
    });
  }

  history(entityType: string, entityId: string) {
    return this.prisma.statusHistory.findMany({
      where: { entityType, entityId },
      orderBy: { changedAt: 'desc' },
      take: 100,
    });
  }
}
