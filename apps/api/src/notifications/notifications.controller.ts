import { Controller, Get, Sse, UseGuards, Request, MessageEvent } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { Observable } from 'rxjs';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @SkipThrottle()
  @Sse('stream')
  stream(@Request() req: any): Observable<MessageEvent> {
    return this.notificationsService.subscribe(req.user.id);
  }

  @Get()
  getRecent(@Request() req: any) {
    return this.notificationsService.getRecent(req.user.id);
  }
}
