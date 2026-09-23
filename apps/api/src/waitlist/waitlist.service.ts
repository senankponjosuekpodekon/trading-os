import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateWaitlistDto } from './dto/waitlist.dto';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  create(dto: CreateWaitlistDto) {
    return this.prisma.waitlistEntry.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        opinion: dto.opinion?.trim() || null,
        contribution: dto.contribution?.trim() || null,
        objectives: dto.objectives?.trim() || null,
      },
    });
  }

  findAll() {
    return this.prisma.waitlistEntry.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Envoie un email "service de retour" à toutes les entrées pas encore
   * contactées, puis les marque comme contactées.
   */
  async notifyAll() {
    const entries = await this.prisma.waitlistEntry.findMany({
      where: { contactedAt: null },
    });

    let sent = 0;
    for (const entry of entries) {
      try {
        const result = await this.mail.send(
          entry.email,
          'Trading OS — le service est de retour',
          `Bonjour ${entry.name},\n\nLa maintenance de Trading OS est terminée — la plateforme est de nouveau accessible.\n\nMerci pour votre patience !`,
          `<p>Bonjour ${entry.name},</p><p>La maintenance de <strong>Trading OS</strong> est terminée — la plateforme est de nouveau accessible.</p><p>Merci pour votre patience !</p>`,
        );
        if (result.sent) sent++;
        await this.prisma.waitlistEntry.update({
          where: { id: entry.id },
          data: { contactedAt: new Date() },
        });
      } catch (err) {
        this.logger.error({ email: entry.email, err }, 'Waitlist notification failed');
      }
    }

    return { notified: sent, total: entries.length };
  }
}
