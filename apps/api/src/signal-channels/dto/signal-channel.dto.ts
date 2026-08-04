import { IsString, IsOptional, IsEnum, MinLength, MaxLength } from 'class-validator';

export enum ChannelVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export class CreateChannelDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(ChannelVisibility)
  visibility?: ChannelVisibility;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(ChannelVisibility)
  visibility?: ChannelVisibility;

  @IsOptional()
  isActive?: boolean;
}
