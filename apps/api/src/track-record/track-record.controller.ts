import {
  BadRequestException, Body, Controller, Delete, Get, Headers,
  Param, Post, UnauthorizedException, UseGuards, Request,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TrackRecordService } from './track-record.service';

@Controller('track-record')
export class TrackRecordController {
  constructor(
    private service: TrackRecordService,
    private config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list() {
    return this.service.list();
  }

  /** Enregistre un call externe (coach, analyste, veille manuelle). */
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Request() req: any, @Body() body: any) {
    if (!body?.symbol || !body?.source) {
      throw new BadRequestException('symbol and source are required');
    }
    return this.service.record({
      symbol: String(body.symbol).slice(0, 40),
      source: String(body.source).slice(0, 80),
      entryPrice: body.entryPrice != null ? Number(body.entryPrice) : null,
      chain: body.chain ?? null,
      tokenAddress: body.tokenAddress ?? null,
      coingeckoId: body.coingeckoId ?? null,
      notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
      createdBy: req.user.id,
    });
  }

  /** Enregistrement automatique par l'engine (moonshot, gem, early-alpha). */
  @Post('internal')
  async internal(@Body() body: any, @Headers() headers: any) {
    const engineKey = this.config.get<string>('ENGINE_API_KEY', '');
    if (!engineKey || (headers['x-engine-key'] || '') !== engineKey) {
      throw new UnauthorizedException('Invalid engine key');
    }
    if (!body?.symbol || !body?.source) {
      throw new BadRequestException('symbol and source are required');
    }
    return this.service.record({
      symbol: String(body.symbol).slice(0, 40),
      source: String(body.source).slice(0, 80),
      entryPrice: body.entryPrice != null ? Number(body.entryPrice) : null,
      chain: body.chain ?? null,
      tokenAddress: body.tokenAddress ?? null,
      coingeckoId: body.coingeckoId ?? null,
      notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
      createdBy: 'engine',
    });
  }

  /** Mutations réservées admin : un user ne doit pas pouvoir clôturer ou
   *  effacer les calls — ça fausserait les KPIs du track record. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post(':id/close')
  close(@Param('id') id: string, @Body() body: any) {
    const exitPrice = body?.exitPrice != null ? Number(body.exitPrice) : null;
    if (exitPrice != null && (!Number.isFinite(exitPrice) || exitPrice <= 0)) {
      throw new BadRequestException('exitPrice must be a positive number');
    }
    return this.service.close(id, exitPrice);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
