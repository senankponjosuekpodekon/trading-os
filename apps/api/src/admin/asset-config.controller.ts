import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Body,
  Param,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AssetConfigService } from './asset-config.service';

@Controller('admin/markets')
export class AssetConfigController {
  constructor(
    private readonly configService: AssetConfigService,
    private readonly appConfig: ConfigService,
  ) {}

  /** Public read-only endpoint for the engine — protected by ENGINE_API_KEY */
  @Get('engine')
  async getMarketsForEngine(@Headers('X-Engine-Key') key?: string) {
    const expected = this.appConfig.get<string>('ENGINE_API_KEY', '');
    if (expected && key !== expected) {
      throw new BadRequestException('Invalid engine key');
    }
    return this.configService.listMarkets();
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async listMarkets() {
    return this.configService.listMarkets();
  }

  @Get(':marketType')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getMarket(@Param('marketType') marketType: string) {
    return this.configService.getMarket(marketType);
  }

  @Put(':marketType')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updateMarket(
    @Param('marketType') marketType: string,
    @Body() body: {
      isActive?: boolean;
      warmupEnabled?: boolean;
      scanInterval?: number | null;
      maxStrategies?: number | null;
      timeframes?: string[];
    },
  ) {
    return this.configService.upsertMarket(marketType, body);
  }

  @Get(':marketType/pairs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async listPairs(@Param('marketType') marketType: string) {
    return this.configService.listPairs(marketType);
  }

  @Put(':marketType/pairs/:symbol')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updatePair(
    @Param('marketType') marketType: string,
    @Param('symbol') symbol: string,
    @Body() body: { isActive?: boolean; warmupEnabled?: boolean },
  ) {
    return this.configService.upsertPair(marketType, symbol, body);
  }

  @Post(':marketType/pairs/bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async bulkUpdatePairs(
    @Param('marketType') marketType: string,
    @Body() body: { pairs: { symbol: string; isActive?: boolean; warmupEnabled?: boolean }[] },
  ) {
    return this.configService.bulkUpdatePairs(marketType, body.pairs);
  }

  @Delete(':marketType/pairs/:symbol')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async deletePair(
    @Param('marketType') marketType: string,
    @Param('symbol') symbol: string,
  ) {
    return this.configService.deletePair(marketType, symbol);
  }
}
