import { Injectable, BadRequestException } from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TwoFactorService {
  constructor(private prisma: PrismaService) {}

  async generateSetup(userId: string) {
    const user = (await this.prisma.user.findUnique({ where: { id: userId } })) as any;
    if (!user) throw new BadRequestException('User not found');

    const secret = speakeasy.generateSecret({
      name: `Trading-OS (${user.email})`,
      length: 32,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret.base32 } as any,
    });

    const otpauthUrl = secret.otpauth_url ?? `otpauth://totp/Trading-OS%20%28${encodeURIComponent(user.email)}%29?secret=${secret.base32}`;
    const qrCode = await QRCode.toDataURL(otpauthUrl);

    return { secret: secret.base32, qrCode, otpauthUrl };
  }

  async enable(userId: string, token: string) {
    const user = (await this.prisma.user.findUnique({ where: { id: userId } })) as any;
    if (!user || !user.totpSecret) throw new BadRequestException('2FA setup required');

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!verified) throw new BadRequestException('Invalid TOTP token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true } as any,
    });

    return { enabled: true };
  }

  async disable(userId: string, token: string) {
    const user = (await this.prisma.user.findUnique({ where: { id: userId } })) as any;
    if (!user || !user.totpEnabled || !user.totpSecret) throw new BadRequestException('2FA not enabled');

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!verified) throw new BadRequestException('Invalid TOTP token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null } as any,
    });

    return { enabled: false };
  }

  verifyToken(secret: string, token: string) {
    return speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
  }

  async getStatus(userId: string) {
    const user = (await this.prisma.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } })) as any;
    return { enabled: !!user?.totpEnabled };
  }
}
