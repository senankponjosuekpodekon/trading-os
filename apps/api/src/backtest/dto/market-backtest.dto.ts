import { IsString, IsNumber, IsOptional, IsObject, Min, Max } from 'class-validator';

export class MarketBacktestDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsString()
  timeframe: string = '1h';

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(1000)
  lookback_bars?: number = 500;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  initial_capital?: number = 10000;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  risk_pct?: number = 1.0;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  min_confidence?: number = 40.0;

  @IsOptional()
  @IsString()
  strategyId?: string;

  @IsOptional()
  @IsObject()
  strategy?: Record<string, any>;
}
