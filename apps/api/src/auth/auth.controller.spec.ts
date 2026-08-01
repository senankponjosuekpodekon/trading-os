import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };

  const mockRes: any = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: { get: jest.fn((key: string, def: any) => def) } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should return tokens from service', async () => {
      const expected = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } };
      mockAuthService.register.mockResolvedValue(expected);

      const result = await controller.register({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test',
      } as any, mockRes);

      expect(result).toEqual(expected);
      expect(mockAuthService.register).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test',
      });
    });
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const expected = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } };
      mockAuthService.login.mockResolvedValue(expected);

      const result = await controller.login({ email: 'test@example.com', password: 'pass' } as any, {} as any, mockRes);

      expect(result).toEqual(expected);
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      mockAuthService.login.mockRejectedValue(new Error('bad creds'));

      await expect(
        controller.login({ email: 'bad@example.com', password: 'pass' } as any, { ip: '127.0.0.1', url: '/auth/login' } as any, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('should return new token pair', async () => {
      const expected = { access_token: 'a2', refresh_token: 'r2' };
      mockAuthService.refresh.mockResolvedValue(expected);

      const result = await controller.refresh({ refresh_token: 'r1' } as any, {} as any, mockRes);

      expect(result).toEqual(expected);
      expect(mockAuthService.refresh).toHaveBeenCalledWith('r1');
    });

    it('should throw UnauthorizedException on invalid refresh token', async () => {
      mockAuthService.refresh.mockRejectedValue(new Error('invalid'));

      await expect(
        controller.refresh({ refresh_token: 'bad' } as any, { ip: '127.0.0.1', url: '/auth/refresh' } as any, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should call logout service and return nothing', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);

      const result = await controller.logout({ refresh_token: 'r1' } as any, {} as any, mockRes);

      expect(result).toBeUndefined();
      expect(mockAuthService.logout).toHaveBeenCalledWith('r1');
    });
  });
});
