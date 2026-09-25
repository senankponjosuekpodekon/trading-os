import { Controller, Get, Post, Patch, Body, Query, Headers, Sse, UseGuards, Request, MessageEvent, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { AlertService } from './alert.service';
import { UpdateNotificationPreferenceDto } from './dto/notification-preference.dto';
import { TrackRecordService } from '../track-record/track-record.service';
import { Observable } from 'rxjs';
import * as jwt from 'jsonwebtoken';

@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private notificationsService: NotificationsService,
    private prefService: NotificationPreferenceService,
    private config: ConfigService,
    private alertService: AlertService,
    private trackRecord: TrackRecordService,
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
    return this.notificationsService.getRecentPersisted(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('preferences')
  getPreferences(@Request() req: any) {
    return this.prefService.getOrCreate(req.user.id);
  }

  @Get('push-public-key')
  @UseGuards(JwtAuthGuard)
  getPushPublicKey() {
    const key = this.config.get<string>('VAPID_PUBLIC_KEY');
    if (!key) return { enabled: false, publicKey: null };
    return { enabled: true, publicKey: key };
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

  @UseGuards(JwtAuthGuard)
  @Post('push-subscribe')
  async pushSubscribe(@Request() req: any, @Body() body: { subscription: any; enabled?: boolean }) {
    if (!body?.subscription) throw new BadRequestException('subscription required');
    return this.prefService.update(req.user.id, {
      pushEnabled: body.enabled ?? true,
      pushSubscription: body.subscription,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('push-unsubscribe')
  async pushUnsubscribe(@Request() req: any) {
    return this.prefService.update(req.user.id, { pushEnabled: false, pushSubscription: undefined });
  }

  @Post('internal/pattern')
  internalPatternAlert(@Body() body: any, @Headers() headers: any) {
    const engineKey = this.config.get<string>('ENGINE_API_KEY', '');
    const providedKey = headers['x-engine-key'] || '';
    if (!engineKey || providedKey !== engineKey) {
      throw new UnauthorizedException('Invalid engine key');
    }
    if (!body?.symbol || !body?.name) {
      throw new BadRequestException('symbol and name are required');
    }
    const direction = body.direction || 'NEUTRAL';
    const timeframe = body.timeframe || 'unknown';
    return this.notificationsService.push({
      userId: '*',
      type: 'ALERT',
      title: `Pattern détecté: ${body.name} (${direction})`,
      message: `${body.symbol} — ${body.name} ${direction} sur ${timeframe}${body.confluenceScore ? ` — Confluence: ${body.confluenceScore}%` : ''}`,
      data: body,
    });
  }

  /**
   * POST /notifications/internal/broadcast — push générique depuis l'engine.
   * Utilisé par les détections non-signal : moonshot, changement de régime
   * onchain, early-alpha forte conviction. Protégé par X-Engine-Key.
   */
  @Post('internal/broadcast')
  async internalBroadcast(@Body() body: any, @Headers() headers: any) {
    const engineKey = this.config.get<string>('ENGINE_API_KEY', '');
    const providedKey = headers['x-engine-key'] || '';
    if (!engineKey || providedKey !== engineKey) {
      throw new UnauthorizedException('Invalid engine key');
    }
    if (!body?.title || !body?.message) {
      throw new BadRequestException('title and message are required');
    }
    const sent = await this.alertService.broadcastPush(
      String(body.title).slice(0, 120),
      String(body.message).slice(0, 500),
      body.data ?? {},
    );

    // Chaque call annoncé est tracké — les résultats prouvent la valeur.
    // data.track === true → on enregistre le pick avec son prix d'entrée.
    const d = body.data ?? {};
    if (d.track === true && d.symbol) {
      this.trackRecord.record({
        symbol: String(d.symbol),
        source: `engine:${d.type ?? 'event'}`,
        entryPrice: d.price != null ? Number(d.price) : null,
        chain: d.chain ?? null,
        tokenAddress: d.token_address ?? null,
        notes: String(body.message).slice(0, 500),
        createdBy: 'engine',
      }).catch((err) => this.logger.warn(`track-record failed: ${err?.message}`));
    }
    return { ok: true, sent };
  }
}
