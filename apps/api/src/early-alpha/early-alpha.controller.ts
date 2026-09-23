import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from '../ai/ai.service';

export interface PresaleProject {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  stage: string;
  listingType: string;
  platform: string;
  raiseUsd: number;
  goalUsd: number;
  fundingPct: number;
  price: number;
  website: string;
  twitter: string;
  asymmetricScore: number;
  riskScore: number; // 100 - asymmetricScore (rétrocompat affichage)
  riskFlags: string[];
  opportunityFlags: string[];
  githubCommits30d: number;
  tvlMillions: number;
  socialBuzz: number;
  source: string;
  url: string;
  tags: string[];
}

export interface OnChainAsym {
  assetSymbol: string;
  chain: string;
  overallSignal: string;
  whaleConcentration: number; // top 10 holders %
  holderGrowth24h: number;
  developerActivity: number; // commits 30j
  socialMentionVelocity: number;
  asymmetricScore: number; // pre_listing_score 0-100
  signalCount: number;
  topSignals: { type: string; severity: string; direction: string; message: string }[];
}

const VALID_SIGNAL_CHAINS = new Set(['ethereum', 'solana', 'bsc']);

@Controller('early-alpha')
@UseGuards(JwtAuthGuard)
export class EarlyAlphaController {
  constructor(private readonly ai: AiService) {}

  @Get('presales')
  async presales(
    @Query('chain') chain?: string,
    @Query('minRisk') minRisk?: string,
    @Query('maxRisk') maxRisk?: string,
  ) {
    const res = await this.ai.preListingDiscover(0, 50);
    let data: PresaleProject[] = (res?.projects ?? []).map((p: any) => {
      const tags = [p.listing_type, p.platform].filter(Boolean);
      return {
        id: `${p.symbol}-${p.source}`,
        name: p.name ?? '',
        symbol: p.symbol ?? '',
        chain: (p.chain ?? '').toUpperCase() || '—',
        stage: p.status ?? 'upcoming',
        listingType: p.listing_type ?? 'IDO',
        platform: p.platform ?? '',
        raiseUsd: p.funds_raised ?? 0,
        goalUsd: p.fundraising_goal ?? 0,
        fundingPct: p.funding_pct ?? 0,
        price: p.token_price ?? 0,
        website: p.website ?? '',
        twitter: p.twitter ?? '',
        asymmetricScore: p.asymmetric_score ?? 0,
        riskScore: 100 - (p.asymmetric_score ?? 0),
        riskFlags: p.risk_flags ?? [],
        opportunityFlags: p.opportunity_flags ?? [],
        githubCommits30d: p.github_commits_30d ?? 0,
        tvlMillions: p.tvl_millions ?? 0,
        socialBuzz: p.social_buzz ?? 0,
        source: p.source ?? '',
        url: p.url ?? p.website ?? '',
        tags,
      };
    });
    if (chain) data = data.filter(p => p.chain.toLowerCase() === chain.toLowerCase());
    if (minRisk) data = data.filter(p => p.riskScore >= Number(minRisk));
    if (maxRisk) data = data.filter(p => p.riskScore <= Number(maxRisk));
    return { data, summary: res?.summary ?? '' };
  }

  @Get('onchain')
  async onchain(@Query('symbol') symbol?: string, @Query('minAsym') minAsym?: string) {
    // Symboles candidats : projets découverts récemment (même pipeline que /presales)
    const res = await this.ai.preListingDiscover(0, 50);
    const projects: any[] = res?.projects ?? [];

    const targets = symbol
      ? projects.filter(p => (p.symbol ?? '').toLowerCase().includes(symbol.toLowerCase()))
      : projects.slice(0, 8);

    const settled = await Promise.allSettled(
      targets.map(p => {
        const chain = VALID_SIGNAL_CHAINS.has((p.chain ?? '').toLowerCase())
          ? (p.chain as string).toLowerCase()
          : 'ethereum';
        return this.ai.preListingSignals(p.symbol, chain).then(r => ({ p, r }));
      }),
    );

    let data: OnChainAsym[] = [];
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const { p, r } = s.value;
      const holder = r?.raw_data?.holder_data ?? {};
      const dev = r?.raw_data?.dev_activity ?? {};
      data.push({
        assetSymbol: r?.symbol ?? p.symbol,
        chain: r?.chain ?? p.chain ?? '',
        overallSignal: r?.overall_signal ?? 'NEUTRAL',
        whaleConcentration: holder.top_10_holders_pct ?? p.top_holder_pct ?? 0,
        holderGrowth24h: holder.holder_growth_24h ?? 0,
        developerActivity: dev.commits_30d ?? p.github_commits_30d ?? 0,
        socialMentionVelocity: p.social_buzz ?? 0,
        asymmetricScore: r?.pre_listing_score ?? p.asymmetric_score ?? 0,
        signalCount: r?.signal_count ?? 0,
        topSignals: (r?.signals ?? []).slice(0, 3).map((sg: any) => ({
          type: sg.signal_type,
          severity: sg.severity,
          direction: sg.direction,
          message: sg.message,
        })),
      });
    }

    if (minAsym) data = data.filter(o => o.asymmetricScore >= Number(minAsym));
    return { data };
  }
}
