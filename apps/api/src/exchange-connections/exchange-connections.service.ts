import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/security/encryption.service';
import { CreateExchangeConnectionDto, UpdateExchangeConnectionDto } from './dto/exchange-connection.dto';

@Injectable()
export class ExchangeConnectionsService {
  private readonly logger = new Logger(ExchangeConnectionsService.name);

  // Permissions that are considered safe for trading (no withdrawal)
  private readonly FORBIDDEN_PERMISSIONS = ['withdraw', 'withdrawal', 'transfer', 'withdraw_spot'];

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async list(userId: string) {
    const connections = await this.prisma.exchangeConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((c) => ({
      id: c.id,
      exchange: c.exchange,
      label: c.label,
      permissions: c.permissions,
      isActive: c.isActive,
      lastValidAt: c.lastValidAt,
      lastError: c.lastError,
      createdAt: c.createdAt,
      apiKeyMasked: this.maskKey(c.apiKey),
    }));
  }

  async create(userId: string, dto: CreateExchangeConnectionDto) {
    this.validatePermissions(dto.permissions ?? []);

    const existingCount = await this.prisma.exchangeConnection.count({
      where: { userId },
    });
    if (existingCount >= 5) {
      throw new BadRequestException('Maximum 5 connexions exchange autorisées par utilisateur.');
    }

    const encryptedKey = `enc:${this.encryption.encrypt(dto.apiKey)}`;
    const encryptedSecret = `enc:${this.encryption.encrypt(dto.apiSecret)}`;

    const connection = await this.prisma.exchangeConnection.create({
      data: {
        userId,
        exchange: dto.exchange,
        label: dto.label,
        apiKey: encryptedKey,
        apiSecret: encryptedSecret,
        permissions: dto.permissions ?? [],
      },
    });

    this.logger.log(`Exchange connection created: user=${userId} exchange=${dto.exchange} label=${dto.label}`);
    return {
      id: connection.id,
      exchange: connection.exchange,
      label: connection.label,
      permissions: connection.permissions,
      isActive: connection.isActive,
      createdAt: connection.createdAt,
    };
  }

  async update(userId: string, id: string, dto: UpdateExchangeConnectionDto) {
    const connection = await this.prisma.exchangeConnection.findFirst({
      where: { id, userId },
    });
    if (!connection) throw new NotFoundException('Exchange connection not found');

    return this.prisma.exchangeConnection.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(userId: string, id: string) {
    const connection = await this.prisma.exchangeConnection.findFirst({
      where: { id, userId },
    });
    if (!connection) throw new NotFoundException('Exchange connection not found');

    await this.prisma.exchangeConnection.delete({ where: { id } });
    this.logger.log(`Exchange connection deleted: user=${userId} id=${id}`);
    return { id };
  }

  async getDecryptedCredentials(userId: string, id: string) {
    const connection = await this.prisma.exchangeConnection.findFirst({
      where: { id, userId, isActive: true },
    });
    if (!connection) throw new NotFoundException('Active exchange connection not found');

    const apiKey = this.encryption.decryptIfNeeded(connection.apiKey);
    const apiSecret = this.encryption.decryptIfNeeded(connection.apiSecret);

    if (!apiKey || !apiSecret) {
      throw new BadRequestException('Failed to decrypt exchange credentials');
    }

    return { apiKey, apiSecret, exchange: connection.exchange, permissions: connection.permissions };
  }

  async markValidated(userId: string, id: string, success: boolean, error?: string) {
    await this.prisma.exchangeConnection.update({
      where: { id, userId },
      data: {
        lastValidAt: new Date(),
        lastError: success ? null : (error ?? 'Validation failed'),
      },
    });
  }

  private validatePermissions(permissions: string[]) {
    for (const perm of permissions) {
      if (this.FORBIDDEN_PERMISSIONS.some((f) => perm.toLowerCase().includes(f))) {
        throw new BadRequestException(
          `Permission "${perm}" is not allowed. Withdrawal permissions are blocked for security.`
        );
      }
    }
  }

  private maskKey(encryptedKey: string): string {
    const decrypted = this.encryption.decryptIfNeeded(encryptedKey);
    if (!decrypted || decrypted.length < 8) return '****';
    return decrypted.slice(0, 4) + '****' + decrypted.slice(-4);
  }
}
