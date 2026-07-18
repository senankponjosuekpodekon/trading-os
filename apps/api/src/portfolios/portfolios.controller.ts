import { Body, Controller, Get, Post, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PortfoliosService } from './portfolios.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';

@Controller('portfolios')
@UseGuards(JwtAuthGuard)
export class PortfoliosController {
  constructor(private portfoliosService: PortfoliosService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.portfoliosService.findByUser(req.user.id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreatePortfolioDto) {
    return this.portfoliosService.create(req.user.id, dto);
  }
}
