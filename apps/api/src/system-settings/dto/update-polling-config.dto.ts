import { IsBoolean, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class UpdatePollingConfigDto {
  @IsOptional()
  @IsBoolean()
  scanPollingEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1_000)
  @Max(300_000)
  scanPollingInterval?: number;
}
