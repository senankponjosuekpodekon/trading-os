import { AlertService, SignalAlertInput } from './alert.service';
import { NotificationsService } from './notifications.service';

describe('AlertService', () => {
  let alertService: AlertService;
  let notificationsService: NotificationsService;

  beforeEach(() => {
    notificationsService = new NotificationsService();
    alertService = new AlertService(notificationsService);
  });

  const baseSignal: SignalAlertInput = {
    symbol: 'BTC/USDT',
    signal: 'BUY',
    confidence: 70,
    timeframe: '1h',
    opportunityScore: 0.7,
  };

  describe('shouldSend', () => {
    it('blocks low-opportunity signals', () => {
      alertService.setOpportunityThreshold(0.8);
      expect(alertService.shouldSend('u1', baseSignal)).toBe(false);
    });

    it('allows high-opportunity signals', () => {
      expect(alertService.shouldSend('u1', baseSignal)).toBe(true);
    });

    it('falls back to confidence/100 when opportunityScore is missing', () => {
      const s: SignalAlertInput = {
        symbol: 'BTC/USDT',
        signal: 'BUY',
        confidence: 80,
        timeframe: '1h',
      };
      expect(alertService.shouldSend('u1', s)).toBe(true);
    });

    it('respects the daily cap', () => {
      alertService.setMaxDaily(2);
      alertService.sendSignal('u1', { ...baseSignal, symbol: 'ETH/USDT' });
      alertService.sendSignal('u1', { ...baseSignal, symbol: 'SOL/USDT' });
      const third = alertService.sendSignal('u1', { ...baseSignal, symbol: 'XRP/USDT' });
      expect(third).toBeNull();
    });

    it('respects the symbol/timeframe cooldown', () => {
      alertService.setMinIntervalMinutes(10);
      const first = alertService.sendSignal('u1', baseSignal);
      expect(first).not.toBeNull();
      const second = alertService.sendSignal('u1', baseSignal);
      expect(second).toBeNull();
    });
  });

  describe('sendSignal', () => {
    it('pushes a notification when allowed', () => {
      const n = alertService.sendSignal('u1', baseSignal);
      expect(n).not.toBeNull();
      expect(n!.type).toBe('SIGNAL');
      expect(n!.title).toContain('BTC/USDT');
    });

    it('returns null when blocked', () => {
      alertService.setOpportunityThreshold(0.95);
      const n = alertService.sendSignal('u1', baseSignal);
      expect(n).toBeNull();
    });
  });

  describe('getStats', () => {
    it('tracks sent today', () => {
      alertService.setMaxDaily(5);
      alertService.sendSignal('u1', baseSignal);
      const stats = alertService.getStats('u1');
      expect(stats.sentToday).toBe(1);
      expect(stats.maxDaily).toBe(5);
    });
  });
});
