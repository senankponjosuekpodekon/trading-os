import { IsString, IsOptional, IsBoolean, IsObject, MaxLength } from 'class-validator';

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
