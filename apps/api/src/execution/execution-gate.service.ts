import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrossPositionRiskService } from '../positions/cross-position-risk.service';

export interface GateResult {
  ok: boolean;
  reason?: string;
  zone?: { lower: number; upper: number; optimal: number };
}

@Injectable()
export class ExecutionGateService {
  private readonly logger = new Logger(ExecutionGateService.name);

  private readonly MIN_RR = 1.0;
  private readonly MIN_RR_BLOCK = 1.5;

  constructor(
    private prisma: PrismaService,
    private crossRisk: CrossPositionRiskService,
  ) {}

  /**
   * Validate that a signal is still executable at the current live price.
   * Checks: expiration, entry zone, SL/TP coherence, minimum R:R.
   */
  validateExecutionGate(
    signal: any,
    livePrice: number,
    portfolioType: 'PAPER' | 'LIVE',
  ): GateResult {
    const isBuy = signal.signal === 'BUY';
    const signalEntry = signal.entryPrice ? parseFloat(signal.entryPrice.toString()) : null;
    const sl = signal.stopLoss ? parseFloat(signal.stopLoss.toString()) : null;
    const tp1 = signal.takeProfit1 ? parseFloat(signal.takeProfit1.toString()) : null;

    // 1. Expiration check
    if (signal.expiresAt && new Date(signal.expiresAt) < new Date()) {
      this.logger.warn(
        `GATE REJECT [EXPIRED] signal=${signal.id} symbol=${signal.asset?.symbol} ` +
        `expiresAt=${signal.expiresAt} now=${new Date().toISOString()} ` +
        `tf=${signal.timeframe} type=${portfolioType}`,
      );
      return { ok: false, reason: `Signal expired at ${signal.expiresAt}` };
    }

    if (!signalEntry || !sl || !tp1) {
      this.logger.warn(
        `GATE SKIP [MISSING_DATA] signal=${signal.id} ` +
        `entry=${signalEntry} sl=${sl} tp1=${tp1} type=${portfolioType}`,
      );
      return { ok: true };
    }

    // 2. Compute entry zone from SL, TP1, MIN_RR
    const slDist = Math.abs(signalEntry - sl);
    const tpDist = Math.abs(tp1 - signalEntry);
    const noiseFloor = slDist * 0.15;

    let zoneLower: number, zoneUpper: number;
    if (isBuy) {
      zoneLower = signalEntry - noiseFloor;
      zoneUpper = sl + tpDist / this.MIN_RR;
      zoneUpper = Math.min(zoneUpper, signalEntry + noiseFloor);
    } else {
      zoneLower = sl - tpDist / this.MIN_RR;
      zoneLower = Math.max(zoneLower, signalEntry - noiseFloor);
      zoneUpper = signalEntry + noiseFloor;
    }

    const zone = { lower: zoneLower, upper: zoneUpper, optimal: (zoneLower + zoneUpper) / 2 };

    // 3. Validate livePrice within entry zone
    if (livePrice < zoneLower || livePrice > zoneUpper) {
      this.logger.warn(
        `GATE REJECT [OUT_OF_ZONE] signal=${signal.id} symbol=${signal.asset?.symbol} ` +
        `livePrice=${livePrice} zone=[${zoneLower.toFixed(6)}, ${zoneUpper.toFixed(6)}] ` +
        `signalEntry=${signalEntry} sl=${sl} tp1=${tp1} ` +
        `isBuy=${isBuy} type=${portfolioType}`,
      );
      return { ok: false, reason: `Price ${livePrice} outside entry zone [${zoneLower.toFixed(4)}, ${zoneUpper.toFixed(4)}]`, zone };
    }

    // 4. SL/TP coherence relative to livePrice
    if (isBuy && livePrice >= sl) {
      this.logger.warn(
        `GATE REJECT [SL_ABOVE_ENTRY] signal=${signal.id} livePrice=${livePrice} sl=${sl} type=${portfolioType}`,
      );
      return { ok: false, reason: `Live price ${livePrice} is at or above stop loss ${sl} for BUY`, zone };
    }
    if (!isBuy && livePrice <= sl) {
      this.logger.warn(
        `GATE REJECT [SL_BELOW_ENTRY] signal=${signal.id} livePrice=${livePrice} sl=${sl} type=${portfolioType}`,
      );
      return { ok: false, reason: `Live price ${livePrice} is at or below stop loss ${sl} for SELL`, zone };
    }

    // 5. R:R check at livePrice
    const liveRR = isBuy
      ? (tp1 - livePrice) / (livePrice - sl)
      : (livePrice - tp1) / (sl - livePrice);

    if (liveRR < this.MIN_RR_BLOCK) {
      this.logger.warn(
        `GATE WARN [LOW_RR] signal=${signal.id} symbol=${signal.asset?.symbol} ` +
        `liveRR=${liveRR.toFixed(2)} threshold=${this.MIN_RR_BLOCK} ` +
        `livePrice=${livePrice} sl=${sl} tp1=${tp1} type=${portfolioType}`,
      );
    }

    this.logger.log(
      `GATE PASS signal=${signal.id} symbol=${signal.asset?.symbol} ` +
      `livePrice=${livePrice} zone=[${zoneLower.toFixed(6)}, ${zoneUpper.toFixed(6)}] ` +
      `liveRR=${liveRR.toFixed(2)} type=${portfolioType}`,
    );

    return { ok: true, zone };
  }

  /**
   * Check for duplicate open position on the same asset in the same portfolio.
   */
  async checkDuplicate(portfolioId: string, assetId: string): Promise<void> {
    const duplicate = await this.prisma.position.findFirst({
      where: {
        portfolioId,
        assetId,
        status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] },
      },
    });
    if (duplicate) throw new ConflictException('DUPLICATE_POSITION');
  }

  /**
   * Check cross-position correlation risk (Phase G).
   */
  async checkCorrelationRisk(portfolioId: string, symbol: string, side: 'BUY' | 'SELL'): Promise<void> {
    await this.crossRisk.checkCorrelationRisk(portfolioId, symbol, side);
  }

  /**
   * Full pre-execution validation for a signal-based order.
   * Combines: signal fetch + gate + anti-doublon + correlation risk.
   */
  async validateSignalExecution(
    signalId: string,
    portfolioId: string,
    livePrice: number,
    portfolioType: 'PAPER' | 'LIVE',
  ): Promise<{ signal: any; gateResult: GateResult }> {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { asset: true },
    });
    if (!signal) throw new NotFoundException('Signal not found');
    if (signal.signal === 'NEUTRAL') throw new BadRequestException('Cannot execute order on NEUTRAL signal');

    // Anti-doublon
    await this.checkDuplicate(portfolioId, signal.assetId);

    // Correlation risk
    await this.checkCorrelationRisk(portfolioId, signal.asset.symbol, signal.signal as 'BUY' | 'SELL');

    // Execution gate
    const gateResult = this.validateExecutionGate(signal, livePrice, portfolioType);
    if (!gateResult.ok) {
      throw new BadRequestException(`Execution gate rejected: ${gateResult.reason}`);
    }

    return { signal, gateResult };
  }
}
