import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePortfolioDto {
  @IsString()
  name: string;

  @IsEnum(['PAPER', 'LIVE'])
  type: 'PAPER' | 'LIVE';

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialCapital?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
