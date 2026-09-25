import {
  BadRequestException, Body, Controller, Delete, Get, Headers,
  Param, Post, UnauthorizedException, UseGuards, Request,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

  @UseGuards(JwtAuthGuard)
  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
