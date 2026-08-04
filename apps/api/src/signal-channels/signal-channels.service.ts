import { Injectable, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/signal-channel.dto';

@Injectable()
export class SignalChannelsService {
  private readonly logger = new Logger(SignalChannelsService.name);

  constructor(private prisma: PrismaService) {}

  async listPublic(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [channels, total] = await Promise.all([
      this.prisma.signalChannel.findMany({
        where: { visibility: 'PUBLIC', isActive: true },
        include: { owner: { select: { id: true, name: true } } },
        orderBy: { subscriberCount: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.signalChannel.count({
        where: { visibility: 'PUBLIC', isActive: true },
      }),
    ]);
    return { data: channels, total, page, limit };
  }

  async listOwned(userId: string) {
    return this.prisma.signalChannel.findMany({
      where: { ownerId: userId },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listSubscribed(userId: string) {
    const subs = await this.prisma.signalChannelSubscription.findMany({
      where: { userId },
      include: {
        channel: {
          include: { owner: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => s.channel);
  }

  async create(userId: string, dto: CreateChannelDto) {
    const channel = await this.prisma.signalChannel.create({
      data: {
        ownerId: userId,
        name: dto.name,
        description: dto.description,
        visibility: dto.visibility ?? 'PUBLIC',
      },
    });
    await this.prisma.signalChannelSubscription.create({
      data: { channelId: channel.id, userId },
    });
    await this.updateSubscriberCount(channel.id);

    this.logger.log(`Channel created: user=${userId} name=${dto.name}`);
    return channel;
  }

  async update(userId: string, channelId: string, dto: UpdateChannelDto) {
    const channel = await this.prisma.signalChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.ownerId !== userId) throw new ForbiddenException('Only the owner can update this channel');

    return this.prisma.signalChannel.update({
      where: { id: channelId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async delete(userId: string, channelId: string) {
    const channel = await this.prisma.signalChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.ownerId !== userId) throw new ForbiddenException('Only the owner can delete this channel');

    await this.prisma.signalChannel.delete({ where: { id: channelId } });
    this.logger.log(`Channel deleted: user=${userId} id=${channelId}`);
    return { id: channelId };
  }

  async subscribe(userId: string, channelId: string) {
    const channel = await this.prisma.signalChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (!channel.isActive) throw new ForbiddenException('Channel is not active');

    const existing = await this.prisma.signalChannelSubscription.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (existing) throw new ConflictException('Already subscribed to this channel');

    await this.prisma.signalChannelSubscription.create({
      data: { channelId, userId },
    });
    await this.updateSubscriberCount(channelId);

    this.logger.log(`User ${userId} subscribed to channel ${channelId}`);
    return { channelId, userId };
  }

  async unsubscribe(userId: string, channelId: string) {
    const sub = await this.prisma.signalChannelSubscription.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    await this.prisma.signalChannelSubscription.delete({
      where: { channelId_userId: { channelId, userId } },
    });
    await this.updateSubscriberCount(channelId);

    this.logger.log(`User ${userId} unsubscribed from channel ${channelId}`);
    return { channelId, userId };
  }

  async getSubscribers(channelId: string, ownerId: string) {
    const channel = await this.prisma.signalChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.ownerId !== ownerId) throw new ForbiddenException('Only the owner can view subscribers');

    const subs = await this.prisma.signalChannelSubscription.findMany({
      where: { channelId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => ({ id: s.id, userId: s.userId, createdAt: s.createdAt, user: s.user }));
  }

  private async updateSubscriberCount(channelId: string) {
    const count = await this.prisma.signalChannelSubscription.count({
      where: { channelId },
    });
    await this.prisma.signalChannel.update({
      where: { id: channelId },
      data: { subscriberCount: count },
    });
  }
}
