import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/security/encryption.service';
import { ExchangeConnectionsService } from './exchange-connections.service';
import { ExchangeName } from './dto/exchange-connection.dto';

describe('ExchangeConnectionsService', () => {
  let service: ExchangeConnectionsService;
  let prisma: any;
  let encryption: Partial<EncryptionService>;

  beforeEach(async () => {
    prisma = {
      exchangeConnection: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    encryption = {
      encrypt: jest.fn((val: string) => `encrypted_${val}`),
      decryptIfNeeded: jest.fn((val: string) => val?.replace('enc:', '')?.replace('encrypted_', '') || ''),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExchangeConnectionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();

    service = moduleRef.get(ExchangeConnectionsService);
  });

  describe('list', () => {
    it('should return connections with masked keys', async () => {
      prisma.exchangeConnection.findMany.mockResolvedValueOnce([
        {
          id: '1',
          exchange: 'BINANCE',
          label: 'Test',
          permissions: [],
          isActive: true,
          lastValidAt: null,
          lastError: null,
          createdAt: new Date(),
          apiKey: 'enc:encrypted_mysecretkey1234',
        },
      ]);

      const result = await service.list('user1');
      expect(result).toHaveLength(1);
      expect(result[0].apiKeyMasked).toContain('****');
    });
  });

  describe('create', () => {
    it('should create a connection with encrypted keys', async () => {
      prisma.exchangeConnection.count.mockResolvedValueOnce(0);
      prisma.exchangeConnection.create.mockResolvedValueOnce({
        id: '1',
        exchange: 'BINANCE',
        label: 'Test',
        permissions: [],
        isActive: true,
        createdAt: new Date(),
      });

      const result = await service.create('user1', {
        exchange: ExchangeName.BINANCE,
        label: 'Test',
        apiKey: 'myapikey1234',
        apiSecret: 'myapisecret',
      });

      expect(result.id).toBe('1');
      expect(encryption.encrypt).toHaveBeenCalledWith('myapikey1234');
      expect(encryption.encrypt).toHaveBeenCalledWith('myapisecret');
    });

    it('should reject withdrawal permissions', async () => {
      await expect(
        service.create('user1', {
          exchange: ExchangeName.BINANCE,
          label: 'Test',
          apiKey: 'myapikey1234',
          apiSecret: 'myapisecret',
          permissions: ['withdraw'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enforce max 5 connections', async () => {
      prisma.exchangeConnection.count.mockResolvedValueOnce(5);

      await expect(
        service.create('user1', {
          exchange: ExchangeName.BINANCE,
          label: 'Test',
          apiKey: 'myapikey1234',
          apiSecret: 'myapisecret',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should throw NotFoundException if connection not found', async () => {
      prisma.exchangeConnection.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update('user1', 'nonexistent', { label: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException if connection not found', async () => {
      prisma.exchangeConnection.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove('user1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should delete connection', async () => {
      prisma.exchangeConnection.findFirst.mockResolvedValueOnce({ id: '1' });
      prisma.exchangeConnection.delete.mockResolvedValueOnce({ id: '1' });

      const result = await service.remove('user1', '1');
      expect(result.id).toBe('1');
    });
  });

  describe('getDecryptedCredentials', () => {
    it('should throw NotFoundException if connection not found', async () => {
      prisma.exchangeConnection.findFirst.mockResolvedValueOnce(null);

      await expect(service.getDecryptedCredentials('user1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should return decrypted credentials', async () => {
      prisma.exchangeConnection.findFirst.mockResolvedValueOnce({
        id: '1',
        exchange: 'BINANCE',
        apiKey: 'enc:encrypted_mykey',
        apiSecret: 'enc:encrypted_mysecret',
        permissions: [],
      });

      const result = await service.getDecryptedCredentials('user1', '1');
      expect(result.apiKey).toBeTruthy();
      expect(result.apiSecret).toBeTruthy();
      expect(result.exchange).toBe('BINANCE');
    });
  });
});
