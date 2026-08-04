import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { NotificationPreferenceService } from './notification-preference.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      notificationPreference: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationPreferenceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NotificationPreferenceService);
    jest.clearAllMocks();
  });

  describe('getOrCreate', () => {
    it('should return existing preferences', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce({
        id: '1',
        userId: 'user1',
        telegramEnabled: true,
        discordEnabled: false,
      });

      const result = await service.getOrCreate('user1');
      expect(result.telegramEnabled).toBe(true);
    });

    it('should create preferences if not found', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce(null);
      prisma.notificationPreference.create.mockResolvedValueOnce({
        id: '2',
        userId: 'user1',
        telegramEnabled: false,
        discordEnabled: false,
        emailEnabled: true,
        minConfidence: 60,
      });

      const result = await service.getOrCreate('user1');
      expect(result.id).toBe('2');
      expect(result.emailEnabled).toBe(true);
    });
  });

  describe('update', () => {
    it('should throw BadRequestException when enabling Telegram without chat ID', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.update('user1', { telegramEnabled: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when enabling Discord without webhook URL', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.update('user1', { discordEnabled: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid Discord webhook URL', async () => {
      await expect(
        service.update('user1', {
          discordWebhookUrl: 'https://example.com/hook',
          discordEnabled: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid Telegram chat ID', async () => {
      await expect(
        service.update('user1', {
          telegramChatId: '!!',
          telegramEnabled: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update successfully with valid data', async () => {
      prisma.notificationPreference.upsert.mockResolvedValueOnce({
        id: '1',
        userId: 'user1',
        telegramChatId: '@mychannel',
        telegramEnabled: true,
        discordEnabled: false,
        emailEnabled: true,
        minConfidence: 70,
      });

      const result = await service.update('user1', {
        telegramChatId: '@mychannel',
        telegramEnabled: true,
        minConfidence: 70,
      });

      expect(result.telegramEnabled).toBe(true);
      expect(result.minConfidence).toBe(70);
    });
  });

  describe('sendTestTelegram', () => {
    it('should throw BadRequestException when no chat ID configured', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce({
        id: '1',
        userId: 'user1',
        telegramChatId: null,
      });

      await expect(service.sendTestTelegram('user1')).rejects.toThrow(BadRequestException);
    });

    it('should send test message successfully', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce({
        id: '1',
        userId: 'user1',
        telegramChatId: '@mychannel',
      });

      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });

      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      const result = await service.sendTestTelegram('user1');
      expect(result.success).toBe(true);
      delete process.env.TELEGRAM_BOT_TOKEN;
    });

    it('should throw BadRequestException when TELEGRAM_BOT_TOKEN not set', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce({
        id: '1',
        userId: 'user1',
        telegramChatId: '@mychannel',
      });

      delete process.env.TELEGRAM_BOT_TOKEN;
      await expect(service.sendTestTelegram('user1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendTestDiscord', () => {
    it('should throw BadRequestException when no webhook URL configured', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce({
        id: '1',
        userId: 'user1',
        discordWebhookUrl: null,
      });

      await expect(service.sendTestDiscord('user1')).rejects.toThrow(BadRequestException);
    });

    it('should send test message successfully', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValueOnce({
        id: '1',
        userId: 'user1',
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      mockedAxios.post.mockResolvedValueOnce({ data: {} });

      const result = await service.sendTestDiscord('user1');
      expect(result.success).toBe(true);
    });
  });
});
