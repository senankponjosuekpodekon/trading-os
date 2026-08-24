import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  const mockConfig = {
    get: jest.fn().mockReturnValue('test_secret'),
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    strategy = module.get<JwtStrategy>(JwtStrategy);
    mockPrisma.user.findUnique.mockReset();
  });

  it('returns sanitized user when active', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      isActive: true,
      password: 'secret',
    });
    const result = await strategy.validate({ sub: 'u1', email: 'a@b.com' });
    expect(result.id).toBe('u1');
    expect(result).not.toHaveProperty('password');
  });

  it('throws when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com' })).rejects.toThrow(UnauthorizedException);
  });

  it('throws when user is inactive', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      isActive: false,
      password: 'secret',
    });
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com' })).rejects.toThrow(UnauthorizedException);
  });
});
