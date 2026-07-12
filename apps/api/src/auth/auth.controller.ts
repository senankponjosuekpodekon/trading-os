import { Controller, Post, Body, HttpCode, HttpStatus, Logger, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

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

  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    try {
      return await this.authService.login(dto);
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
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    try {
      return await this.authService.refresh(dto.refresh_token);
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
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refresh_token);
  }
}
