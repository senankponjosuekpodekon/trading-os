import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsIn } from 'class-validator';

export enum UserRole {
  TRADER = 'TRADER',
  INVESTOR = 'INVESTOR',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
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
  @IsIn([UserRole.TRADER, UserRole.INVESTOR])
  role?: UserRole.TRADER | UserRole.INVESTOR;
}
