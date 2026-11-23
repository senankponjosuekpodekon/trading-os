import { IsOptional, IsString, IsBoolean, IsInt, IsObject, Min, Max, MaxLength } from 'class-validator';

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

  // Granularité par type : { signals, movement, synthetic_edge,
  // hidden_gems, gem_paper, onchain, early_alpha } — true/false par clé.
  // Absent ou clé inconnue = autorisé (fail-open).
  @IsOptional()
  @IsObject()
  typePrefs?: Record<string, boolean>;
}
