import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { EngineKeyGuard } from './engine-key.guard';
import { ConfigService } from '@nestjs/config';

describe('EngineKeyGuard', () => {
  let guard: EngineKeyGuard;

  const mockConfig = {
    get: jest.fn(),
  };

  const context = (header?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-engine-key': header },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EngineKeyGuard, { provide: ConfigService, useValue: mockConfig }],
    }).compile();
    guard = module.get<EngineKeyGuard>(EngineKeyGuard);
    mockConfig.get.mockReset();
  });

  it('allows when the key matches', () => {
    mockConfig.get.mockReturnValue('secret');
    expect(guard.canActivate(context('secret'))).toBe(true);
  });

  it('throws when key is missing', () => {
    mockConfig.get.mockReturnValue('secret');
    expect(() => guard.canActivate(context(undefined))).toThrow(UnauthorizedException);
  });

  it('throws when key does not match', () => {
    mockConfig.get.mockReturnValue('secret');
    expect(() => guard.canActivate(context('wrong'))).toThrow(UnauthorizedException);
  });

  it('throws when no engine key is configured', () => {
    mockConfig.get.mockReturnValue(undefined);
    expect(() => guard.canActivate(context('anything'))).toThrow(UnauthorizedException);
  });
});
