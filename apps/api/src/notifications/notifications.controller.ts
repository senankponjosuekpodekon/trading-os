import { Controller, Get, Query, Sse, UseGuards, Request, MessageEvent, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { Observable } from 'rxjs';
import * as jwt from 'jsonwebtoken';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
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
      { expiresIn: '60s' },
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
}
