import { IsString, IsNumber, IsOptional, IsBoolean, IsEnum, IsArray } from 'class-validator';
import { BillingInterval } from '@prisma/client';

export class CreatePlanDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsNumber()
  price: number;

  @IsEnum(BillingInterval)
  interval: BillingInterval;

  @IsOptional()
  @IsNumber()
  maxStrategies?: number;

  @IsOptional()
  @IsNumber()
  maxSignals?: number;

  @IsOptional()
  @IsNumber()
  maxPortfolios?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
