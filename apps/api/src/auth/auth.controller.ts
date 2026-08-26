import { Controller, Post, Body, HttpCode, HttpStatus, Logger, Req, UnauthorizedException, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { IsString, IsOptional, IsEmail, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ConfigService } from '@nestjs/config';

class RefreshDto {
  @IsString()
  @IsOptional()
  refresh_token?: string;
}

class LogoutDto {
  @IsString()
  @IsOptional()
  refresh_token?: string;
}

class VerifyEmailDto {
  @IsString()
  token!: string;
}

class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

@Controller('auth')
@Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 10, ttl: 60_000 }, long: { limit: 15, ttl: 300_000 } })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const cookieSecure = this.config.get<string>('COOKIE_SECURE');
    const secure = cookieSecure ? cookieSecure === '1' : this.config.get<string>('NODE_ENV') === 'production';
    const sameSite = secure ? 'strict' : 'lax';
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const data = await this.authService.register(dto);
    this.setAuthCookies(res, data.access_token, data.refresh_token);
    return data;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 60_000 }, medium: { limit: 5, ttl: 60_000 }, long: { limit: 10, ttl: 300_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const data = await this.authService.login(dto);
      this.setAuthCookies(res, data.access_token, data.refresh_token);
      return data;
    } catch (err) {
      this.logger.warn({
        email: dto.email,
        ip: req.ip || req.socket.remoteAddress,
        path: req.url,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }, 'Login failed');
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const refreshToken = req.cookies?.['refresh_token'] || dto.refresh_token;
      if (!refreshToken) throw new UnauthorizedException('No refresh token');
      const data = await this.authService.refresh(refreshToken);
      this.setAuthCookies(res, data.access_token, data.refresh_token);
      return data;
    } catch (err) {
      this.logger.warn({
        ip: req.ip || req.socket.remoteAddress,
        path: req.url,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }, 'Refresh failed');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = dto.refresh_token || req.cookies?.['refresh_token'];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearAuthCookies(res);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    // TODO: wire SMTP sender (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
    return { queued: true, email: dto.email };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = (req.user as any)?.id;
    if (!userId) throw new UnauthorizedException('Not authenticated');
    const result = await this.authService.changePassword(userId, dto.currentPassword, dto.newPassword);
    this.clearAuthCookies(res);
    return result;
  }
}
