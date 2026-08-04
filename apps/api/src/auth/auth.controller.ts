import { Controller, Post, Body, HttpCode, HttpStatus, Logger, Req, UnauthorizedException, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ConfigService } from '@nestjs/config';

class RefreshDto {
  refresh_token: string;
}

class LogoutDto {
  refresh_token: string;
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
    const sameSite = secure ? 'none' : 'lax';
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
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
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const refreshToken = dto.refresh_token || req.cookies?.['refresh_token'];
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
}
