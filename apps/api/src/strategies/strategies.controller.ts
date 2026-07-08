import { Controller, Get, Post, Put, Delete, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StrategiesService } from './strategies.service';
import { CreateStrategyDto, UpdateStrategyDto, ToggleUserStrategyDto } from './dto/create-strategy.dto';

@UseGuards(JwtAuthGuard)
@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.strategiesService.findAllWithUserStatus(req.user.id);
  }

  @Get('stats')
  getStats() {
    return this.strategiesService.getStats();
  }

  @Get('mine')
  getUserStrategies(@Request() req: any) {
    return this.strategiesService.getUserStrategies(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.strategiesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateStrategyDto) {
    return this.strategiesService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStrategyDto) {
    return this.strategiesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.strategiesService.remove(id);
  }

  @Patch(':id/toggle')
  toggleUserStrategy(
    @Request() req: any,
    @Param('id') strategyId: string,
    @Body() dto: ToggleUserStrategyDto,
  ) {
    return this.strategiesService.toggleUserStrategy(req.user.id, strategyId, dto);
  }
}
