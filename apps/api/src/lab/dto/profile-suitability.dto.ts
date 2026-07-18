import { IsString, IsIn, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class ProfileSuitabilityDto {
  @IsString()
  @IsIn(['conservative', 'moderate', 'aggressive'])
  riskLevel: 'conservative' | 'moderate' | 'aggressive';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDrawdownPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minWinRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minSharpe?: number;
}
