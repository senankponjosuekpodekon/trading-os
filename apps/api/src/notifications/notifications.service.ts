import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject, Observable, filter, map } from 'rxjs';

export interface Notification {
  id:        string;
  userId:    string;
  type:      'SIGNAL' | 'POSITION' | 'ALERT' | 'SYSTEM';
  title:     string;
  message:   string;
  data?:     any;
  createdAt: Date;
}

@Injectable()
export class NotificationsService {
  private readonly subject = new Subject<Notification>();
  private readonly store   = new Map<string, Notification[]>(); // userId -> notifications[]

  subscribe(userId: string): Observable<MessageEvent> {
    return this.subject.asObservable().pipe(
      filter(n => n.userId === userId || n.userId === '*'),
      map(n => ({
        data: n,
        type: n.type.toLowerCase(),
        id:   n.id,
      }) as MessageEvent),
    );
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

  getRecent(userId: string, limit = 20): Notification[] {
    const user   = this.store.get(userId)    ?? [];
    const global = this.store.get('__global__') ?? [];
    return [...user, ...global]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}
