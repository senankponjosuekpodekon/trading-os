import { IsEnum, IsString, MinLength, MaxLength, IsOptional, IsArray, IsBoolean } from 'class-validator';

export enum ExchangeName {
  BINANCE = 'BINANCE',
  BYBIT = 'BYBIT',
  OKX = 'OKX',
  DERIV = 'DERIV',
  BRVM = 'BRVM',
  OANDA = 'OANDA',
  MT5 = 'MT5',
}

export class CreateExchangeConnectionDto {
  @IsEnum(ExchangeName)
  exchange!: ExchangeName;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsString()
  @MinLength(1)
  apiKey!: string;

  @IsString()
  @MinLength(1)
  apiSecret!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class UpdateExchangeConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
