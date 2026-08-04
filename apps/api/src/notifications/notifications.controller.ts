import { Controller, Get, Post, Patch, Body, Query, Sse, UseGuards, Request, MessageEvent, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { UpdateNotificationPreferenceDto } from './dto/notification-preference.dto';
import { Observable } from 'rxjs';
import * as jwt from 'jsonwebtoken';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private prefService: NotificationPreferenceService,
    private config: ConfigService,
  ) {}

  /**
   * Issues a short-lived (60s) SSE token for EventSource connections.
   * The frontend calls this with a normal JWT, then uses the returned
   * token as a query param for the SSE stream — avoiding long-lived
   * JWT exposure in URLs.
   */
  @UseGuards(JwtAuthGuard)
  @Get('sse-token')
  getSseToken(@Request() req: any) {
    const secret = this.config.get<string>('JWT_SECRET')!;
    const token = jwt.sign(
      { sub: req.user.id, purpose: 'sse' },
      secret,
      { expiresIn: '5m' },
    );
    return { sseToken: token };
  }

  @SkipThrottle()
  @Sse('stream')
  stream(@Query('sse_token') sseToken: string, @Query('token') legacyToken: string): Observable<MessageEvent> {
    const token = sseToken || legacyToken;
    if (!token) throw new UnauthorizedException('Missing SSE token');

    const secret = this.config.get<string>('JWT_SECRET')!;
    try {
      const payload: any = jwt.verify(token, secret);
      if (payload.purpose !== 'sse' && !legacyToken) {
        throw new UnauthorizedException('Invalid token type');
      }
      return this.notificationsService.subscribe(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid or expired SSE token');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  getRecent(@Request() req: any) {
    return this.notificationsService.getRecent(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('preferences')
  getPreferences(@Request() req: any) {
    return this.prefService.getOrCreate(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('preferences')
  updatePreferences(@Request() req: any, @Body() dto: UpdateNotificationPreferenceDto) {
    return this.prefService.update(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('preferences/test-telegram')
  testTelegram(@Request() req: any) {
    return this.prefService.sendTestTelegram(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('preferences/test-discord')
  testDiscord(@Request() req: any) {
    return this.prefService.sendTestDiscord(req.user.id);
  }
}
