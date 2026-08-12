import { Body, Controller, Post, Get, Param, Request, UseGuards } from '@nestjs/common';
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
}
