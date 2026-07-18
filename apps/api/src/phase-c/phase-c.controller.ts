import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export interface PresaleToken {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  stage: string;
  salePrice: number;
  listingEstimate: number;
  vesting: string;
  riskScore: number;
  tags: string[];
  updatedAt: string;
}

export interface WhaleAlert {
  id: string;
  assetSymbol: string;
  blockchain: string;
  from: string;
  to: string;
  amount: number;
  valueUsd: number;
  type: 'transfer' | 'exchange_inflow' | 'exchange_outflow';
  timestamp: string;
}

export interface DevActivity {
  assetSymbol: string;
  commits7d: number;
  commits30d: number;
  contributors: number;
  openIssues: number;
  closedIssues: number;
  score: number; // 0-100
}

export interface DefiMetric {
  protocol: string;
  chain: string;
  tvl: number;
  apy: number;
  volume24h: number;
  revenue30d: number;
  riskRating: 'Low' | 'Medium' | 'High';
}

@Controller('phase-c')
@UseGuards(JwtAuthGuard)
export class PhaseCController {
  private readonly _presales: PresaleToken[] = [
    { id: 'ps1', name: 'Nexum Protocol', symbol: 'NXM', chain: 'ETH', stage: 'private', salePrice: 0.12, listingEstimate: 0.18, vesting: '10% TGE, 6 mois', riskScore: 62, tags: ['DePIN'], updatedAt: '2026-07-17T10:00:00Z' },
    { id: 'ps2', name: 'Aurora DAO', symbol: 'AURA', chain: 'SOL', stage: 'public', salePrice: 0.05, listingEstimate: 0.08, vesting: '15% TGE, 12 mois', riskScore: 48, tags: ['DAO'], updatedAt: '2026-07-17T10:00:00Z' },
  ];

  private readonly _whales: WhaleAlert[] = [
    { id: 'w1', assetSymbol: 'BTC', blockchain: 'Bitcoin', from: '1A...x', to: 'Binance', amount: 4500, valueUsd: 280_000_000, type: 'exchange_inflow', timestamp: '2026-07-17T09:30:00Z' },
    { id: 'w2', assetSymbol: 'ETH', blockchain: 'Ethereum', from: '0x2...y', to: 'Unknown', amount: 32000, valueUsd: 95_000_000, type: 'transfer', timestamp: '2026-07-17T09:15:00Z' },
  ];

  private readonly _devActivity: DevActivity[] = [
    { assetSymbol: 'ETH', commits7d: 142, commits30d: 610, contributors: 45, openIssues: 180, closedIssues: 120, score: 85 },
    { assetSymbol: 'SOL', commits7d: 89, commits30d: 410, contributors: 28, openIssues: 95, closedIssues: 82, score: 78 },
    { assetSymbol: 'LINK', commits7d: 34, commits30d: 150, contributors: 12, openIssues: 44, closedIssues: 38, score: 62 },
  ];

  private readonly _defiMetrics: DefiMetric[] = [
    { protocol: 'Aave', chain: 'ETH', tvl: 8_200_000_000, apy: 4.2, volume24h: 120_000_000, revenue30d: 8_500_000, riskRating: 'Low' },
    { protocol: 'Lido', chain: 'ETH', tvl: 22_000_000_000, apy: 3.1, volume24h: 85_000_000, revenue30d: 18_000_000, riskRating: 'Low' },
    { protocol: 'PancakeSwap', chain: 'BSC', tvl: 1_400_000_000, apy: 12.5, volume24h: 310_000_000, revenue30d: 4_200_000, riskRating: 'Medium' },
  ];

  @Get('presales')
  presales(@Query('chain') chain?: string) {
    let data = this._presales;
    if (chain) data = data.filter(p => p.chain.toLowerCase() === chain.toLowerCase());
    return { data };
  }

  @Get('whales')
  whales(@Query('asset') asset?: string, @Query('type') type?: string) {
    let data = this._whales;
    if (asset) data = data.filter(w => w.assetSymbol.toLowerCase() === asset.toLowerCase());
    if (type) data = data.filter(w => w.type === type);
    return { data };
  }

  @Get('dev-activity')
  devActivity(@Query('minScore') minScore?: string) {
    let data = this._devActivity;
    if (minScore) data = data.filter(d => d.score >= Number(minScore));
    return { data };
  }

  @Get('defi')
  defi(@Query('chain') chain?: string) {
    let data = this._defiMetrics;
    if (chain) data = data.filter(d => d.chain.toLowerCase() === chain.toLowerCase());
    return { data };
  }
}
