import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import { JwtAuthGuard } from './jwt-auth.guard';

class TwoFactorDto {
  token: string;
}

@Controller('auth/2fa')
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(private twoFactorService: TwoFactorService) {}

  @Post('setup')
  setup(@Request() req: any) {
    return this.twoFactorService.generateSetup(req.user.id);
  }

  @Post('enable')
  enable(@Request() req: any, @Body() dto: TwoFactorDto) {
    return this.twoFactorService.enable(req.user.id, dto.token);
  }

  @Post('disable')
  disable(@Request() req: any, @Body() dto: TwoFactorDto) {
    return this.twoFactorService.disable(req.user.id, dto.token);
  }

  @Get('status')
  status(@Request() req: any) {
    return this.twoFactorService.getStatus(req.user.id);
  }
}
