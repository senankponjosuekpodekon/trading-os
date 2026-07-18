import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import { TwoFactorService } from './two-factor.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TwoFactorService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<TwoFactorService>(TwoFactorService);
    jest.clearAllMocks();
  });

  describe('generateSetup', () => {
    it('should create a secret and qr code for the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'test@example.com' });
      const result = await service.generateSetup('u1');
      expect(result.secret).toBeDefined();
      expect(result.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });
  });

  describe('enable', () => {
    it('should enable 2FA when token is valid', async () => {
      const secret = speakeasy.generateSecret().base32;
      const token = speakeasy.totp({ secret, encoding: 'base32' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', totpSecret: secret });
      const result = await service.enable('u1', token);
      expect(result.enabled).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ totpEnabled: true }) }),
      );
    });

    it('should reject an invalid token', async () => {
      const secret = speakeasy.generateSecret().base32;
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', totpSecret: secret });
      await expect(service.enable('u1', '000000')).rejects.toThrow(BadRequestException);
    });
  });

  describe('disable', () => {
    it('should disable 2FA when token is valid', async () => {
      const secret = speakeasy.generateSecret().base32;
      const token = speakeasy.totp({ secret, encoding: 'base32' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', totpEnabled: true, totpSecret: secret });
      const result = await service.disable('u1', token);
      expect(result.enabled).toBe(false);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ totpEnabled: false, totpSecret: null }) }),
      );
    });
  });
});
