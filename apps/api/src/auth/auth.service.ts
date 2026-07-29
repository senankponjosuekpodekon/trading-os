import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { rlsContext } from '../prisma/rls-context';
import { AuditService } from '../audit/audit.service';
import { TwoFactorService } from './two-factor.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly REFRESH_TTL_DAYS = 30;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private twoFactor: TwoFactorService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name,
        role: dto.role as any ?? 'TRADER',
      },
    });

    // No JWT/authenticated request context exists yet for this brand-new
    // user — the RLS-enforced client would otherwise reject this insert
    // (fail-closed). We explicitly scope it to the user we just created.
    await rlsContext.run(user.id, () =>
      this.prisma.portfolio.create({
        data: {
          name: 'Mon Portfolio',
          type: 'PAPER',
          userId: user.id,
        },
      }),
    );

    const tokens = await this.generateTokenPair(user.id, user.email);
    const { password: _password, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = (await this.prisma.user.findUnique({ where: { email: dto.email } })) as any;
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (!user.isActive) throw new UnauthorizedException('Account disabled');

    if (user.totpEnabled) {
      if (!dto.totpToken) throw new UnauthorizedException('2FA token required');
      const verified = this.twoFactor.verifyToken(user.totpSecret, dto.totpToken);
      if (!verified) throw new UnauthorizedException('Invalid 2FA token');
    }

    const tokens = await this.generateTokenPair(user.id, user.email);
    const { password: _password, ...userWithoutPassword } = user;
    // Same reasoning as register(): no request-scoped RLS context exists
    // during login itself, audit_logs is RLS-protected.
    await rlsContext.run(user.id, () =>
      this.audit.log({ userId: user.id, action: 'LOGIN', resource: 'auth', details: { email: dto.email } }),
    );
    return { user: userWithoutPassword, ...tokens };
  }

  async refresh(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Détection de réutilisation : si déjà remplacé, revoke tous les tokens du user
    if (stored.replacedBy) {
      await this.revokeAllUserTokens(stored.userId);
      throw new UnauthorizedException('Token reuse detected');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid user');
    }

    const tokens = await this.generateTokenPair(user.id, user.email, stored.id);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, ...tokens };
  }

  async logout(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (stored) {
      await rlsContext.run(stored.userId, () =>
        this.audit.log({ userId: stored.userId, action: 'LOGOUT', resource: 'auth' }),
      );
    }
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async generateTokenPair(userId: string, email: string, replaceTokenId?: string) {
    const accessToken = this.jwt.sign({ sub: userId, email });
    const rawRefresh = crypto.randomBytes(64).toString('hex');
    const refreshHash = this.hashToken(rawRefresh);

    const refresh = await this.prisma.refreshToken.create({
      data: {
        tokenHash: refreshHash,
        userId,
        expiresAt: new Date(Date.now() + this.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
        ...(replaceTokenId ? { replacedBy: replaceTokenId } : {}),
      },
    });

    if (replaceTokenId) {
      await this.prisma.refreshToken.update({
        where: { id: replaceTokenId },
        data: { replacedBy: refresh.id, revokedAt: new Date() },
      });
    }

    return { access_token: accessToken, refresh_token: rawRefresh };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
