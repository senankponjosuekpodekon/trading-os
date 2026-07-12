import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsEnum } from 'class-validator';

export enum UserRole {
  TRADER = 'TRADER',
  INVESTOR = 'INVESTOR',
}

export class RegisterDto {
  @IsEmail()
  @MaxLength(120)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(120)
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
