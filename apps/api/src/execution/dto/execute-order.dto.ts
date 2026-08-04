import { IsString, IsEnum, IsNumber, IsOptional, IsArray, Min, Max } from 'class-validator';

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP_LOSS = 'STOP_LOSS',
  STOP_LOSS_LIMIT = 'STOP_LOSS_LIMIT',
  TAKE_PROFIT = 'TAKE_PROFIT',
  TAKE_PROFIT_LIMIT = 'TAKE_PROFIT_LIMIT',
}

export enum TimeInForce {
  GTC = 'GTC',
  IOC = 'IOC',
  FOK = 'FOK',
}

export class ExecuteOrderDto {
  @IsString()
  connectionId: string;

  @IsString()
  symbol: string;

  @IsEnum(OrderSide)
  side: OrderSide;

  @IsEnum(OrderType)
  type: OrderType;

  @IsNumber()
  @Min(0.00000001)
  quantity: number;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsEnum(TimeInForce)
  timeInForce?: TimeInForce;

  @IsOptional()
  @IsNumber()
  stopPrice?: number;

  @IsOptional()
  @IsString()
  portfolioId?: string;

  @IsOptional()
  @IsString()
  signalId?: string;
}
