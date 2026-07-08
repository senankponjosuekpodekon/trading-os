import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateStrategyDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
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
  name?: string;

  @IsOptional()
  @IsString()
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
