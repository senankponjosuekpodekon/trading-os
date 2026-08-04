import { firstValueFrom } from 'rxjs';
import { take, toArray, filter } from 'rxjs/operators';
import { NotificationsService, Notification } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    service = new NotificationsService();
  });

  describe('push', () => {
    it('assigns an id and createdAt', () => {
      const n = service.push({
        userId: 'u1',
        type: 'ALERT',
        title: 'Test',
        message: 'Hello',
      });

      expect(n.id).toBeDefined();
      expect(n.createdAt).toBeInstanceOf(Date);
      expect(n.userId).toBe('u1');
    });

    it('stores at most 50 notifications per user', () => {
      for (let i = 0; i < 60; i++) {
        service.push({ userId: 'u1', type: 'SYSTEM', title: `n${i}`, message: '' });
      }
      const recent = service.getRecent('u1', 100);
      expect(recent.length).toBe(50);
      // Les plus récentes sont conservées (unshift → tête de liste)
      expect(recent[0].title).toBe('n59');
    });

    it('emits the notification to subscribers', async () => {
      const promise = firstValueFrom(service.subscribe('u1').pipe(filter(e => e.id !== undefined)));
      const pushed = service.push({ userId: 'u1', type: 'SIGNAL', title: 'S', message: 'M' });

      const event = await promise;
      expect(event.id).toBe(pushed.id);
      expect(event.type).toBe('signal');
      expect((event.data as Notification).title).toBe('S');
    });
  });

  describe('subscribe', () => {
    it('filters notifications by userId', async () => {
      const eventsPromise = firstValueFrom(
        service.subscribe('u1').pipe(filter(e => e.id !== undefined), take(2), toArray()),
      );

      service.push({ userId: 'u2', type: 'ALERT', title: 'other-user', message: '' });
      service.push({ userId: 'u1', type: 'ALERT', title: 'mine-1', message: '' });
      service.push({ userId: 'u1', type: 'ALERT', title: 'mine-2', message: '' });

      const events = await eventsPromise;
      const titles = events.map(e => (e.data as Notification).title);
      expect(titles).toEqual(['mine-1', 'mine-2']);
    });

    it('delivers global (*) notifications to every subscriber', async () => {
      const promise = firstValueFrom(service.subscribe('u1').pipe(filter(e => e.id !== undefined)));

      service.pushGlobal('SYSTEM', 'Maintenance', 'à 22h');

      const event = await promise;
      expect((event.data as Notification).title).toBe('Maintenance');
      expect((event.data as Notification).userId).toBe('*');
    });

    it('emits mlRegime inside SIGNAL SSE payloads', async () => {
      const promise = firstValueFrom(service.subscribe('u1').pipe(filter(e => e.id !== undefined)));

      service.pushSignal('u1', { symbol: 'ETH/USDT', signal: 'SELL', confidence: 66, mlRegime: 'LOW' });

      const event = await promise;
      const notification = event.data as Notification;
      expect(notification.type).toBe('SIGNAL');
      expect(notification.data?.mlRegime).toBe('LOW');
    });
  });

  describe('pushSignal', () => {
    it('formats title and message from the signal', () => {
      const n = service.pushSignal('u1', { symbol: 'BTC/USDT', signal: 'BUY', confidence: 78, expectedMove: { move_pct: 4.2 }, mlConfidence: 74.3, mlRegime: 'HIGH' });

      expect(n.type).toBe('SIGNAL');
      expect(n.title).toContain('BUY');
      expect(n.title).toContain('BTC/USDT');
      expect(n.message).toContain('78%');
      expect(n.message).toContain('±4.20%');
      expect(n.message).toContain('ML 74.3%');
      expect(n.message).toContain('Regime HIGH');
      expect(n.data).toEqual({ symbol: 'BTC/USDT', signal: 'BUY', confidence: 78, expectedMove: { move_pct: 4.2 }, mlConfidence: 74.3, mlRegime: 'HIGH' });
    });
  });

  describe('getRecent', () => {
    it('merges user and global notifications sorted by date desc', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T10:00:00Z'));
      service.push({ userId: 'u1', type: 'ALERT', title: 'old-user', message: '' });
      jest.setSystemTime(new Date('2026-01-01T11:00:00Z'));
      service.pushGlobal('SYSTEM', 'mid-global', '');
      jest.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      service.push({ userId: 'u1', type: 'ALERT', title: 'new-user', message: '' });
      jest.useRealTimers();

      const titles = service.getRecent('u1').map(n => n.title);
      expect(titles).toEqual(['new-user', 'mid-global', 'old-user']);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 30; i++) {
        service.push({ userId: 'u1', type: 'SYSTEM', title: `n${i}`, message: '' });
      }
      expect(service.getRecent('u1', 5).length).toBe(5);
    });

    it('does not leak other users notifications', () => {
      service.push({ userId: 'u2', type: 'ALERT', title: 'secret', message: '' });
      const titles = service.getRecent('u1').map(n => n.title);
      expect(titles).not.toContain('secret');
    });

    it('returns empty array for unknown user', () => {
      expect(service.getRecent('nobody')).toEqual([]);
    });
  });
});
