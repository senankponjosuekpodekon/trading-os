import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExchangeConnectionsService } from './exchange-connections.service';
import { CreateExchangeConnectionDto, UpdateExchangeConnectionDto } from './dto/exchange-connection.dto';

@Controller('exchange-connections')
@UseGuards(JwtAuthGuard)
export class ExchangeConnectionsController {
  constructor(private readonly service: ExchangeConnectionsService) {}

  @Get()
  list(@Request() req: any) {
    return this.service.list(req.user.id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateExchangeConnectionDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateExchangeConnectionDto) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }
}
