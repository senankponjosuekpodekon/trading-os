import { IsString, IsNumber, IsOptional } from 'class-validator';

export class ConfirmOrderDto {
  @IsString()
  positionId!: string;

  @IsOptional()
  @IsNumber()
  fillPrice?: number;

  @IsOptional()
  @IsNumber()
  fillQuantity?: number;
}
