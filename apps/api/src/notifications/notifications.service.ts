import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Subject, Observable, filter, map, merge, interval, startWith } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { rlsContext } from '../prisma/rls-context';

export interface Notification {
  id:        string;
  userId:    string;
  type:      'SIGNAL' | 'POSITION' | 'ALERT' | 'SYSTEM';
  title:     string;
  message:   string;
  data?:     any;
  createdAt: Date;
  read?:     boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger  = new Logger(NotificationsService.name);
  private readonly subject = new Subject<Notification>();
  private readonly store   = new Map<string, Notification[]>(); // userId -> notifications[]
  private readonly lastRead = new Map<string, number>();         // userId -> timestamp dernier "mark all read"

  constructor(private prisma?: PrismaService) {}

  /** Marque tout comme lu — mémoire + DB (survit au restart). */
  markAllRead(userId: string) {
    const now = Date.now();
    this.lastRead.set(userId, now);
    if (this.prisma?.notification) {
      void Promise.resolve(
        this.prisma.notification.updateMany({
          where: { userId, readAt: null },
          data: { readAt: new Date(now) },
        }),
      ).catch((err) => this.logger.warn(`markAllRead persist failed: ${err?.message}`));
    }
  }

  subscribe(userId: string): Observable<MessageEvent> {
    const notifications$ = this.subject.asObservable().pipe(
      filter(n => n.userId === userId || n.userId === '*'),
      map(n => ({
        data: n,
        type: n.type.toLowerCase(),
        id:   n.id,
      }) as MessageEvent),
    );
    const heartbeat$ = interval(15_000).pipe(
      startWith(0),
      map(() => ({ data: { type: 'heartbeat' } }) as MessageEvent),
    );
    return merge(notifications$, heartbeat$);
  }

  push(notification: Omit<Notification, 'id' | 'createdAt'>) {
    const n: Notification = {
      ...notification,
      id:        crypto.randomUUID(),
      createdAt: new Date(),
    };

    const key = n.userId === '*' ? '__global__' : n.userId;
    if (!this.store.has(key)) this.store.set(key, []);
    const arr = this.store.get(key)!;
    arr.unshift(n);
    if (arr.length > 50) arr.splice(50);

    // Persistance DB (fire-and-forget) — '*' n'a pas de user_id en DB, skip.
    // Optional chaining : les mocks Prisma partiels ne cassent pas le push.
    // rlsContext.run : la table notifications est sous RLS. Les chemins
    // système (broadcast engine, crons) n'ont pas de contexte request —
    // on scope explicitement l'écriture sur le user destinataire, sinon
    // l'INSERT est rejeté par le WITH CHECK de la policy.
    if (n.userId !== '*' && this.prisma?.notification) {
      void Promise.resolve(
        rlsContext.run(n.userId, () =>
          this.prisma!.notification.create({
          data: {
            id: n.id,
            userId: n.userId,
            type: n.type,
            title: n.title,
            message: n.message,
            data: n.data === undefined ? undefined : n.data,
          },
          }),
        ),
      ).catch((err) => this.logger.warn(`Notification persist failed: ${err?.message}`));
    }

    this.subject.next(n);
    return n;
  }

  pushSignal(
    userId: string,
    signal: {
      symbol: string;
      signal: string;
      confidence: number;
      expectedMove?: { move_pct?: number | null };
      mlConfidence?: number | null;
      mlRegime?: string | null;
    },
  ) {
    const moveSnippet = signal.expectedMove?.move_pct != null
      ? ` · ±${signal.expectedMove.move_pct.toFixed(2)}%`
      : '';
    const mlSnippet = signal.mlConfidence != null ? ` · ML ${signal.mlConfidence.toFixed(1)}%` : '';
    const regimeSnippet = signal.mlRegime ? ` · Regime ${signal.mlRegime}` : '';
    return this.push({
      userId,
      type:    'SIGNAL',
      title:   `Signal ${signal.signal} — ${signal.symbol}`,
      message: `Confiance ${signal.confidence}%${moveSnippet}${mlSnippet}${regimeSnippet} sur ${signal.symbol}`,
      data:    signal,
    });
  }

  pushGlobal(type: Notification['type'], title: string, message: string) {
    return this.push({ userId: '*', type, title, message });
  }

  /** Historique fusionné mémoire + DB — survit au restart API */
  async getRecentPersisted(userId: string, limit = 20): Promise<Notification[]> {
    const memory = this.getRecent(userId, limit);
    const lastRead = this.lastRead.get(userId) ?? 0;

    let rows: { id: string; type: string; title: string; message: string; data: unknown; createdAt: Date; readAt: Date | null }[] = [];
    if (this.prisma) {
      try {
        rows = (await this.prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })) ?? [];
      } catch {
        rows = [];
      }
    }

    const seen = new Set(memory.map((n) => n.id));
    const merged = memory.slice();
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      merged.push({
        id: r.id,
        userId,
        type: r.type as Notification['type'],
        title: r.title,
        message: r.message,
        data: r.data as Notification['data'],
        createdAt: r.createdAt,
        read: r.readAt != null,
      });
    }
    for (const n of merged) {
      n.read = n.read ?? (n.createdAt.getTime() <= lastRead);
    }
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged.slice(0, limit);
  }

  getRecent(userId: string, limit = 20): Notification[] {
    const user   = this.store.get(userId)    ?? [];
    const global = this.store.get('__global__') ?? [];
    return [...user, ...global]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}
