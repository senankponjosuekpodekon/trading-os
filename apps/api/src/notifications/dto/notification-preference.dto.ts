import { IsOptional, IsString, IsBoolean, IsInt, Min, Max, MaxLength } from 'class-validator';

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: PushSubscriptionKeys;
}

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

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  pushSubscription?: PushSubscription;
}
