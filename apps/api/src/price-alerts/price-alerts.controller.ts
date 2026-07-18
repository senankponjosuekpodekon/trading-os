import { Controller, Get, Post, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { PriceAlertsService } from './price-alerts.service';
import { CreatePriceAlertDto } from './dto/create-price-alert.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('price-alerts')
@UseGuards(JwtAuthGuard)
export class PriceAlertsController {
  constructor(private readonly service: PriceAlertsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreatePriceAlertDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.service.findByUser(req.user.id);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }
}
