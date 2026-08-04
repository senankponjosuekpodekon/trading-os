import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SystemSettingsService } from './system-settings.service';
import { UpdateLlmConfigDto } from './dto/update-llm-config.dto';

@Controller('system/llm-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  getLlmConfig() {
    return this.settings.getLlmConfig();
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch()
  updateLlmConfig(@Request() req: any, @Body() dto: UpdateLlmConfigDto) {
    return this.settings.setLlmConfig(dto, req.user.id);
  }
}
