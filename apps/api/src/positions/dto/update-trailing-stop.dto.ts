import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export enum TrailingMethod {
  ATR = 'atr',
  SWING = 'swing',
  EMA = 'ema',
  CHANDELIER = 'chandelier',
}

export class UpdateTrailingStopDto {
  @IsOptional()
  @IsEnum(TrailingMethod)
  method?: TrailingMethod;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
