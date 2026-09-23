import * as webPush from 'web-push';
import { AlertService, SignalAlertInput } from './alert.service';
import { NotificationsService } from './notifications.service';
import { NotificationPreferenceService } from './notification-preference.service';

jest.mock('axios', () => ({
  default: { post: jest.fn().mockResolvedValue({ data: { ok: true } }) },
}));

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({}),
}));

describe('AlertService', () => {
  let alertService: AlertService;
  let notificationsService: NotificationsService;
  let prefService: jest.Mocked<Partial<NotificationPreferenceService>>;

  beforeEach(() => {
    notificationsService = new NotificationsService();
    prefService = {
      getOrCreate: jest.fn().mockResolvedValue({ pushEnabled: false }),
    };
    alertService = new AlertService(notificationsService, prefService as NotificationPreferenceService);
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

  describe('sendTelegramAlert', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...OLD_ENV };
    });

    afterAll(() => {
      process.env = OLD_ENV;
    });

    it('does nothing if telegram config is missing', () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_GROUP_CHAT_ID;
      expect(alertService.sendSignal('u1', baseSignal)).not.toBeNull();
    });

    it('sends a telegram message when configured', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
      process.env.TELEGRAM_GROUP_CHAT_ID = '-100123';
      const spy = jest.spyOn(alertService as any, 'sendTelegramAlert');
      alertService.sendSignal('u1', baseSignal);
      await new Promise(r => setTimeout(r, 50));
      expect(spy).toHaveBeenCalledWith(baseSignal);
    });
  });

  describe('sendPushAlert', () => {
    it('sends a web push when subscription is active', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:test@test.com';
      alertService = new AlertService(notificationsService, prefService as NotificationPreferenceService);
      (prefService.getOrCreate as jest.Mock).mockResolvedValue({
        pushEnabled: true,
        pushSubscription: {
          endpoint: 'https://push.test/1',
          keys: { p256dh: 'p256', auth: 'auth' },
        },
      });
      const spy = jest.spyOn(alertService as any, 'sendPushAlert');
      alertService.sendSignal('u1', baseSignal);
      await new Promise(r => setTimeout(r, 50));
      expect(spy).toHaveBeenCalledWith('u1', baseSignal);
    });

    it('broadcasts to every push subscriber when userId is *', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:test@test.com';
      prefService.findPushSubscribed = jest.fn().mockResolvedValue([
        { userId: 'u1', pushSubscription: { endpoint: 'https://push.test/1', keys: { p256dh: 'a', auth: 'b' } }, minConfidence: 60 },
        { userId: 'u2', pushSubscription: { endpoint: 'https://push.test/2', keys: { p256dh: 'c', auth: 'd' } }, minConfidence: 90 },
      ]);
      alertService = new AlertService(notificationsService, prefService as NotificationPreferenceService);
      (webPush.sendNotification as jest.Mock).mockClear();

      alertService.sendSignal('*', baseSignal); // score 70 → u1 (min 60) reçoit, u2 (min 90) filtré
      await new Promise(r => setTimeout(r, 50));

      expect(prefService.findPushSubscribed).toHaveBeenCalled();
      expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
      expect((webPush.sendNotification as jest.Mock).mock.calls[0][0].endpoint).toBe('https://push.test/1');
    });
  });
});
