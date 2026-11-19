import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PhaseBDataService } from './phase-b-data.service';

export interface TokenomicsMetric {
  assetSymbol: string;
  nextUnlockPct: number;
  nextUnlockDate: string | null;
  top10HoldersPct: number;
  source: string; // 'api' | 'mock' — le front badge les données simulées
}

export interface SocialSentiment {
  assetSymbol: string;
  galaxyScore: number;
  altRank: number;
  socialDominance: number;
  interactionsPerPost: number;
  sentiment: number | null;
  source: string; // 'lunarcrush' | 'mock'
}

export interface BrvmStock {
  symbol: string;
  name: string;
  sector: string;
  priceXof: number;
  changePercent: number;
  volume: number;
}

export interface SyntheticAsset {
  symbol: string;
  underlying: string;
  collateralRatio: number;
  price: number;
  fundingRate: number;
  liquidityDepth: number;
}

@Controller('phase-b')
@UseGuards(JwtAuthGuard)
export class PhaseBDataController {
  constructor(private readonly phaseBDataService: PhaseBDataService) {}

  @Get('tokenomics')
  async tokenomics(@Query('asset') asset?: string): Promise<{ data: TokenomicsMetric[] }> {
    return { data: await this.phaseBDataService.tokenomics(asset) };
  }

  @Get('social')
  async social(@Query('trending') trending?: string): Promise<{ data: SocialSentiment[] }> {
    return { data: await this.phaseBDataService.social(trending) };
  }

  @Get('brvm')
  async brvm(@Query('sector') sector?: string): Promise<{ data: BrvmStock[] }> {
    return { data: await this.phaseBDataService.brvm(sector) };
  }

  @Get('synthetic')
  async synthetic(@Query('underlying') underlying?: string): Promise<{ data: SyntheticAsset[] }> {
    return { data: await this.phaseBDataService.synthetic(underlying) };
  }
}
