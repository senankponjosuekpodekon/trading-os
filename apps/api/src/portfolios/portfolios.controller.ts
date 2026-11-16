import { Body, Controller, Get, Param, Post, Put, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
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

  @Get(':id/state')
  state(@Request() req: any, @Param('id') id: string) {
    return this.portfoliosService.state(req.user.id, id);
  }

  @Get(':id/snapshots')
  snapshots(@Request() req: any, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.portfoliosService.snapshots(req.user.id, id, limit ? +limit : 168);
  }

  @Get(':id/ledger')
  ledger(@Request() req: any, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.portfoliosService.ledger(req.user.id, id, limit ? +limit : 100);
  }

  /** Config exécution effective : ligne DB + statut adapters (engine). */
  @Get('execution/config')
  execConfig() {
    return this.portfoliosService.execConfig();
  }

  /** Pilotage live — admin uniquement. Mode + venues + fail-closed. */
  @Put('execution/config')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  updateExecConfig(@Request() req: any, @Body() dto: { mode?: string; live_venues?: string[]; gate_fail_closed?: boolean }) {
    return this.portfoliosService.updateExecConfig(req.user.id, dto);
  }
}
