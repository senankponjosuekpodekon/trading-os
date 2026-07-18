import { IsInt, IsOptional, IsString, Max, Min, Length } from 'class-validator';

export class CreateSignalFeedbackDto {
  @IsString()
  signalId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  grade: number;

  @IsString()
  @IsOptional()
  @Length(0, 500)
  comment?: string;

  @IsOptional()
  outcome?: number;
}
