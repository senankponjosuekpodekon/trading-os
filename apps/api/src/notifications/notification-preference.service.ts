import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationPreferenceDto } from './dto/notification-preference.dto';

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(private prisma: PrismaService) {}

  async getOrCreate(userId: string) {
    let pref = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (!pref) {
      pref = await this.prisma.notificationPreference.create({
        data: { userId },
      });
      this.logger.log(`Notification preferences created for user ${userId}`);
    }
    return pref;
  }

  async update(userId: string, dto: UpdateNotificationPreferenceDto) {
    if (dto.telegramEnabled && !dto.telegramChatId) {
      const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
      if (!existing?.telegramChatId) {
        throw new BadRequestException('Un Chat ID Telegram est requis pour activer Telegram.');
      }
    }

    if (dto.discordEnabled && !dto.discordWebhookUrl) {
      const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
      if (!existing?.discordWebhookUrl) {
        throw new BadRequestException('Une URL de webhook Discord est requise pour activer Discord.');
      }
    }

    if (dto.discordWebhookUrl && !this.isValidDiscordWebhook(dto.discordWebhookUrl)) {
      throw new BadRequestException('URL de webhook Discord invalide. Format attendu: https://discord.com/api/webhooks/...');
    }

    if (dto.telegramChatId && !this.isValidTelegramChatId(dto.telegramChatId)) {
      throw new BadRequestException('Chat ID Telegram invalide. Doit être numérique ou commencer par @.');
    }

    const pref = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        telegramChatId: dto.telegramChatId,
        telegramEnabled: dto.telegramEnabled ?? false,
        discordWebhookUrl: dto.discordWebhookUrl,
        discordEnabled: dto.discordEnabled ?? false,
        emailEnabled: dto.emailEnabled ?? true,
        minConfidence: dto.minConfidence ?? 60,
      },
      update: {
        ...(dto.telegramChatId !== undefined && { telegramChatId: dto.telegramChatId }),
        ...(dto.telegramEnabled !== undefined && { telegramEnabled: dto.telegramEnabled }),
        ...(dto.discordWebhookUrl !== undefined && { discordWebhookUrl: dto.discordWebhookUrl }),
        ...(dto.discordEnabled !== undefined && { discordEnabled: dto.discordEnabled }),
        ...(dto.emailEnabled !== undefined && { emailEnabled: dto.emailEnabled }),
        ...(dto.minConfidence !== undefined && { minConfidence: dto.minConfidence }),
      },
    });

    this.logger.log(`Notification preferences updated for user ${userId}: telegram=${pref.telegramEnabled} discord=${pref.discordEnabled}`);
    return pref;
  }

  async sendTestTelegram(userId: string) {
    const pref = await this.getOrCreate(userId);
    if (!pref.telegramChatId) {
      throw new BadRequestException('Aucun Chat ID Telegram configuré.');
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new BadRequestException('TELEGRAM_BOT_TOKEN non configuré sur le serveur.');
    }

    try {
      const axios = await import('axios');
      await axios.default.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          chat_id: pref.telegramChatId,
          text: '✅ *Test Trading OS* — Vos notifications Telegram sont opérationnelles !',
          parse_mode: 'Markdown',
        },
        { timeout: 5000 },
      );
      this.logger.log(`Telegram test sent to user ${userId}`);
      return { success: true, message: 'Message de test envoyé sur Telegram.' };
    } catch (err: any) {
      const msg = err?.response?.data?.description || err?.message || 'Erreur inconnue';
      this.logger.error(`Telegram test failed for user ${userId}: ${msg}`);
      throw new BadRequestException(`Échec de l\'envoi Telegram: ${msg}`);
    }
  }

  async sendTestDiscord(userId: string) {
    const pref = await this.getOrCreate(userId);
    if (!pref.discordWebhookUrl) {
      throw new BadRequestException('Aucun webhook Discord configuré.');
    }

    try {
      const axios = await import('axios');
      await axios.default.post(
        pref.discordWebhookUrl,
        {
          embeds: [{
            title: '✅ Test Trading OS',
            description: 'Vos notifications Discord sont opérationnelles !',
            color: 0x00ff00,
            timestamp: new Date().toISOString(),
          }],
        },
        { timeout: 5000 },
      );
      this.logger.log(`Discord test sent to user ${userId}`);
      return { success: true, message: 'Message de test envoyé sur Discord.' };
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue';
      this.logger.error(`Discord test failed for user ${userId}: ${msg}`);
      throw new BadRequestException(`Échec de l\'envoi Discord: ${msg}`);
    }
  }

  private isValidDiscordWebhook(url: string): boolean {
    return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(url);
  }

  private isValidTelegramChatId(chatId: string): boolean {
    return /^[@\-]?\w{3,100}$/.test(chatId);
  }
}
