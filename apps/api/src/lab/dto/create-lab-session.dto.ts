import { IsString, IsOptional, IsObject, IsIn } from 'class-validator';

export class CreateLabSessionDto {
  @IsString()
  name: string;

  @IsString()
  symbol: string;

  @IsString()
  timeframe: string;

  @IsOptional()
  @IsObject()
  strategy?: Record<string, any>;

  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'RUNNING', 'COMPLETED', 'ARCHIVED'])
  status?: string;
}
