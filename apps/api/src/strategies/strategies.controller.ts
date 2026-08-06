import { Controller, Get, Post, Put, Delete, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { StrategiesService } from './strategies.service';
import { CreateStrategyDto, UpdateStrategyDto, ToggleUserStrategyDto } from './dto/create-strategy.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
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

  @Roles(UserRole.ADMIN)
  @Get('performance')
  getStrategyPerformance() {
    return this.strategiesService.getStrategyPerformance();
  }

  @Get('mine')
  getUserStrategies(@Request() req: any) {
    return this.strategiesService.getUserStrategies(req.user.id);
  }

  @Put('mine/:strategyId')
  updateUserStrategy(
    @Request() req: any,
    @Param('strategyId') strategyId: string,
    @Body() dto: ToggleUserStrategyDto,
  ) {
    return this.strategiesService.updateUserStrategy(req.user.id, strategyId, dto.customRules, dto.isEnabled);
  }

  @Delete('mine/:strategyId')
  removeUserStrategy(
    @Request() req: any,
    @Param('strategyId') strategyId: string,
  ) {
    return this.strategiesService.removeUserStrategy(req.user.id, strategyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.strategiesService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateStrategyDto) {
    return this.strategiesService.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Post('from-text')
  fromText(@Body() body: { description: string; save?: boolean }) {
    return this.strategiesService.fromText(body.description, body.save ?? false);
  }

  @Roles(UserRole.ADMIN)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStrategyDto) {
    return this.strategiesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
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
