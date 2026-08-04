import { IsOptional, IsString, IsBoolean, IsInt, Min, Max, MaxLength } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  telegramChatId?: string;

  @IsOptional()
  @IsBoolean()
  telegramEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  discordWebhookUrl?: string;

  @IsOptional()
  @IsBoolean()
  discordEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minConfidence?: number;
}
