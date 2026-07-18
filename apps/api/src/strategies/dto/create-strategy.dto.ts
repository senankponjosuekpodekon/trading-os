import { IsString, IsOptional, IsBoolean, IsObject, MaxLength, IsIn } from 'class-validator';

const VALID_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export class CreateStrategyDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsObject()
  rules: Record<string, any>;

  @IsOptional()
  @IsString()
  @IsIn(VALID_TFS)
  analysisTimeframe?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_TFS)
  entryTimeframe?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStrategyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsObject()
  rules?: Record<string, any>;

  @IsOptional()
  @IsString()
  @IsIn(VALID_TFS)
  analysisTimeframe?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_TFS)
  entryTimeframe?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ToggleUserStrategyDto {
  @IsBoolean()
  isEnabled: boolean;

  @IsOptional()
  @IsObject()
  customRules?: Record<string, any>;
}
