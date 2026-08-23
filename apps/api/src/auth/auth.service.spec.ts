import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TwoFactorService } from './two-factor.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    portfolio: {
      create: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockJwt = {
    sign: jest.fn(() => 'mock-token'),
  };

  const mockAudit = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  const mockTwoFactor = {
    verifyToken: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: AuditService, useValue: mockAudit },
        { provide: TwoFactorService, useValue: mockTwoFactor },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user and create a portfolio', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        password: 'hashed',
        name: 'Test',
        role: 'TRADER',
        isActive: true,
      });
      mockPrisma.portfolio.create.mockResolvedValue({ id: 'p1', name: 'Mon Portfolio' });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1', tokenHash: 'hash' });

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test',
      } as any);

      expect(result.access_token).toBe('mock-token');
      expect(result.refresh_token).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
      expect(mockPrisma.portfolio.create).toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return access_token for valid credentials', async () => {
      const hashed = await bcrypt.hash('password123', 12);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        password: hashed,
        isActive: true,
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1', tokenHash: 'hash' });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.access_token).toBe('mock-token');
      expect(result.refresh_token).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException for unknown email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        password: await bcrypt.hash('other', 12),
        isActive: true,
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for disabled account', async () => {
      const hashed = await bcrypt.hash('password123', 12);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        password: hashed,
        isActive: false,
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should require 2FA token when TOTP is enabled', async () => {
      const hashed = await bcrypt.hash('password123', 12);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        password: hashed,
        isActive: true,
        totpEnabled: true,
        totpSecret: 'secret',
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow('2FA token required');
    });
  });

  describe('refresh', () => {
    it('should rotate refresh token and return new pair', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        tokenHash: 'hash',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedBy: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        name: 'Test',
        role: 'TRADER',
        isActive: true,
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt2', tokenHash: 'new-hash' });
      mockPrisma.refreshToken.update.mockResolvedValue({ id: 'rt1', revokedAt: new Date() });

      const result = await service.refresh('raw-refresh-token');

      expect(result.access_token).toBe('mock-token');
      expect(result.refresh_token).toBeDefined();
      expect(mockPrisma.refreshToken.update).toHaveBeenCalled();
    });

    it('should detect token reuse and revoke all user tokens', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        tokenHash: 'hash',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedBy: 'rt2',
      });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.refresh('stolen-token')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should reject invalid refresh token', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('invalid')).rejects.toThrow(UnauthorizedException);
    });
  });
});
