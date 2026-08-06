import { IsString, IsNumber, IsOptional, IsEnum, IsBoolean, MaxLength } from 'class-validator';

export enum Direction {
  BUY  = 'BUY',
  SELL = 'SELL',
}

export enum TrailingMethod {
  ATR = 'atr',
  SWING = 'swing',
  EMA = 'ema',
  CHANDELIER = 'chandelier',
}

export class CreatePositionDto {
  @IsString()
  portfolioId: string;

  @IsString()
  @MaxLength(30)
  assetSymbol: string;

  @IsEnum(Direction)
  direction: Direction;

  @IsNumber()
  entryPrice: number;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @IsOptional()
  @IsNumber()
  takeProfit?: number;

  @IsOptional()
  @IsNumber()
  takeProfit2?: number;

  @IsOptional()
  @IsNumber()
  takeProfit3?: number;

  @IsOptional()
  @IsEnum(TrailingMethod)
  trailingMethod?: TrailingMethod;

  @IsOptional()
  @IsBoolean()
  trailingActive?: boolean;

  @IsOptional()
  @IsString()
  signalId?: string;
}
