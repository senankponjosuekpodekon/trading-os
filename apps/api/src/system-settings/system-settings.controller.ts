import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SystemSettingsService } from './system-settings.service';
import { UpdateLlmConfigDto } from './dto/update-llm-config.dto';
import { UpdatePollingConfigDto } from './dto/update-polling-config.dto';

@Controller('system')
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Get('llm-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  getLlmConfig() {
    return this.settings.getLlmConfig();
  }

  @Patch('llm-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  updateLlmConfig(@Request() req: any, @Body() dto: UpdateLlmConfigDto) {
    return this.settings.setLlmConfig(dto, req.user.id);
  }

  @Get('polling-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  getPollingConfig() {
    return this.settings.getPollingConfig();
  }

  @Patch('polling-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  updatePollingConfig(@Request() req: any, @Body() dto: UpdatePollingConfigDto) {
    return this.settings.setPollingConfig(dto, req.user.id);
  }

  @Get('polling-config/public')
  getPollingConfigPublic() {
    return this.settings.getPollingConfig();
  }
}
