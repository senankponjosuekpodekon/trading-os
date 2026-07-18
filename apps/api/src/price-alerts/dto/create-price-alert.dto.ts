import { IsIn, IsNumber, IsString, Min } from 'class-validator';

export class CreatePriceAlertDto {
  @IsString()
  assetSymbol: string;

  @IsIn(['above', 'below'])
  direction: 'above' | 'below';

  @IsNumber()
  @Min(0)
  targetPrice: number;
}
