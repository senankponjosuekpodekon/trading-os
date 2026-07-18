import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export interface PresaleProject {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  stage: 'seed' | 'private' | 'public';
  raiseUsd: number;
  fdvUsd: number;
  price: number;
  vesting: string;
  riskScore: number; // 0-100
  tags: string[];
}

export interface OnChainAsym {
  assetSymbol: string;
  whaleConcentration: number; // top 10 holders %
  exchangeInflow24h: number;
  exchangeOutflow24h: number;
  netFlow24h: number;
  developerActivity: number; // commits / week
  ageDays: number;
  socialMentionVelocity: number; // mentions/hour
  asymmetricScore: number; // 0-100 composite
}

@Controller('early-alpha')
@UseGuards(JwtAuthGuard)
export class EarlyAlphaController {
  private readonly projects: PresaleProject[] = [
    { id: 'p1', name: 'Nexum Protocol', symbol: 'NXM', chain: 'ETH', stage: 'private', raiseUsd: 1_200_000, fdvUsd: 18_000_000, price: 0.12, vesting: '10% TGE, 6 mois lineaire', riskScore: 62, tags: ['DePIN', 'L2'] },
    { id: 'p2', name: 'Aurora DAO', symbol: 'AURA', chain: 'SOL', stage: 'public', raiseUsd: 800_000, fdvUsd: 9_500_000, price: 0.05, vesting: '15% TGE, 12 mois lineaire', riskScore: 48, tags: ['DAO', 'RWA'] },
    { id: 'p3', name: 'Orbit AI', symbol: 'ORAI', chain: 'ARB', stage: 'seed', raiseUsd: 2_500_000, fdvUsd: 45_000_000, price: 0.30, vesting: '5% TGE, 18 mois lineaire', riskScore: 75, tags: ['AI', 'Infra'] },
    { id: 'p4', name: 'PulseNode', symbol: 'PULSE', chain: 'BSC', stage: 'private', raiseUsd: 600_000, fdvUsd: 6_000_000, price: 0.02, vesting: '20% TGE, 3 mois lineaire', riskScore: 81, tags: ['DeFi', 'Nodes'] },
    { id: 'p5', name: 'Cypher Zero', symbol: 'CZERO', chain: 'ETH', stage: 'public', raiseUsd: 1_500_000, fdvUsd: 22_000_000, price: 0.08, vesting: '12% TGE, 9 mois lineaire', riskScore: 55, tags: ['Privacy', 'ZK'] },
  ];

  private readonly onChain: OnChainAsym[] = [
    { assetSymbol: 'NXM/USDT', whaleConcentration: 34.5, exchangeInflow24h: 120_000, exchangeOutflow24h: 85_000, netFlow24h: 35_000, developerActivity: 42, ageDays: 180, socialMentionVelocity: 120, asymmetricScore: 68 },
    { assetSymbol: 'AURA/USDT', whaleConcentration: 22.1, exchangeInflow24h: 45_000, exchangeOutflow24h: 78_000, netFlow24h: -33_000, developerActivity: 18, ageDays: 90, socialMentionVelocity: 65, asymmetricScore: 45 },
    { assetSymbol: 'ORAI/USDT', whaleConcentration: 41.0, exchangeInflow24h: 310_000, exchangeOutflow24h: 95_000, netFlow24h: 215_000, developerActivity: 61, ageDays: 240, socialMentionVelocity: 210, asymmetricScore: 82 },
    { assetSymbol: 'PULSE/USDT', whaleConcentration: 58.2, exchangeInflow24h: 250_000, exchangeOutflow24h: 40_000, netFlow24h: 210_000, developerActivity: 8, ageDays: 60, socialMentionVelocity: 340, asymmetricScore: 88 },
    { assetSymbol: 'CZERO/USDT', whaleConcentration: 28.7, exchangeInflow24h: 90_000, exchangeOutflow24h: 92_000, netFlow24h: -2_000, developerActivity: 33, ageDays: 300, socialMentionVelocity: 95, asymmetricScore: 52 },
  ];

  @Get('presales')
  presales(@Query('chain') chain?: string, @Query('minRisk') minRisk?: string, @Query('maxRisk') maxRisk?: string) {
    let data = this.projects;
    if (chain) data = data.filter(p => p.chain.toLowerCase() === chain.toLowerCase());
    if (minRisk) data = data.filter(p => p.riskScore >= Number(minRisk));
    if (maxRisk) data = data.filter(p => p.riskScore <= Number(maxRisk));
    return { data };
  }

  @Get('onchain')
  onchain(@Query('symbol') symbol?: string, @Query('minAsym') minAsym?: string) {
    let data = this.onChain;
    if (symbol) data = data.filter(o => o.assetSymbol.toLowerCase().includes(symbol.toLowerCase()));
    if (minAsym) data = data.filter(o => o.asymmetricScore >= Number(minAsym));
    return { data };
  }
}
