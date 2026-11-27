import { Body, Controller, Post, Get, Param, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { ExecutionService } from './execution.service';
import { ExecuteOrderDto } from './dto/execute-order.dto';
import { ConfirmOrderDto } from './dto/confirm-order.dto';

@Controller('execution')
@UseGuards(JwtAuthGuard)
export class ExecutionController {
  constructor(private readonly service: ExecutionService) {}

  @Get('exchanges')
  getSupportedExchanges() {
    return this.service.getSupportedExchanges();
  }

  @Post('order')
  @Throttle({ short: { ttl: 1_000, limit: 3 }, medium: { ttl: 10_000, limit: 10 } })
  executeOrder(@Request() req: any, @Body() dto: ExecuteOrderDto) {
    return this.service.executeOrder(req.user.id, dto);
  }

  @Post('validate/:connectionId')
  validateConnection(@Request() req: any, @Param('connectionId') connectionId: string) {
    return this.service.validateConnection(req.user.id, connectionId);
  }

  @Get('balance/:connectionId')
  getBalance(@Request() req: any, @Param('connectionId') connectionId: string) {
    return this.service.getBalance(req.user.id, connectionId);
  }

  @Post('confirm')
  @Throttle({ short: { ttl: 1_000, limit: 5 }, medium: { ttl: 10_000, limit: 20 } })
  confirmOrder(@Request() req: any, @Body() dto: ConfirmOrderDto) {
    return this.service.confirmOrder(req.user.id, dto);
  }

  // ── Gestion directe des positions MT5 (compte du bridge) ──────────
  // Exige que l'utilisateur possède une connexion MT5 active — les
  // opérations touchent LE compte du bridge, pas un compte par user.

  @Get('mt5/positions')
  mt5Positions(@Request() req: any) {
    return this.service.mt5Positions(req.user.id);
  }

  @Post('mt5/close')
  mt5Close(@Request() req: any, @Body() body: { symbol?: string }) {
    if (!body?.symbol) throw new BadRequestException('symbol requis');
    return this.service.mt5CloseSymbol(req.user.id, body.symbol);
  }

  @Post('mt5/close-all')
  mt5CloseAll(@Request() req: any) {
    return this.service.mt5CloseAll(req.user.id);
  }

  @Post('mt5/modify')
  mt5Modify(@Request() req: any, @Body() body: { symbol?: string; sl?: number; tp?: number }) {
    if (!body?.symbol) throw new BadRequestException('symbol requis');
    return this.service.mt5ModifyStops(req.user.id, body.symbol, body.sl, body.tp);
  }
}
