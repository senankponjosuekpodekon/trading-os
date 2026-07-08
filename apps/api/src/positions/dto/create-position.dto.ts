import { IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';

export enum Direction {
  BUY  = 'BUY',
  SELL = 'SELL',
}

export class CreatePositionDto {
  @IsString()
  portfolioId: string;

  @IsString()
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
  @IsString()
  signalId?: string;
}
