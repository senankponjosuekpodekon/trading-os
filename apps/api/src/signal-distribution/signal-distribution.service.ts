import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramDispatcher, DiscordDispatcher, SignalPayload } from './dispatchers';

@Injectable()
export class SignalDistributionService {
  private readonly logger = new Logger(SignalDistributionService.name);

  constructor(
    private prisma: PrismaService,
    private telegram: TelegramDispatcher,
    private discord: DiscordDispatcher,
  ) {}

  async distributeSignal(channelId: string, signal: SignalPayload) {
    const channel = await this.prisma.signalChannel.findUnique({
      where: { id: channelId },
    });
    if (!channel) return { sent: 0, failed: 0 };

    const subscriptions = await this.prisma.signalChannelSubscription.findMany({
      where: { channelId },
    });

    const telegramChatIds = subscriptions
      .map((s) => (s as any).telegramChatId)
      .filter(Boolean) as string[];
    const discordWebhooks = subscriptions
      .map((s) => (s as any).discordWebhookUrl)
      .filter(Boolean) as string[];

    let sent = 0;
    let failed = 0;

    if (telegramChatIds.length > 0) {
      const tgResult = await this.telegram.sendToMultiple(telegramChatIds, signal);
      sent += tgResult.sent;
      failed += tgResult.failed;
    }

    if (discordWebhooks.length > 0) {
      const dcResult = await this.discord.sendToMultiple(discordWebhooks, signal);
      sent += dcResult.sent;
      failed += dcResult.failed;
    }

    this.logger.log(`Signal distributed to channel ${channelId}: sent=${sent} failed=${failed}`);
    return { sent, failed };
  }

  async distributeToUserTelegram(userId: string, chatId: string, signal: SignalPayload) {
    return this.telegram.sendToChannel(chatId, signal);
  }

  async distributeToUserDiscord(userId: string, webhookUrl: string, signal: SignalPayload) {
    return this.discord.sendToWebhook(webhookUrl, signal);
  }
}
