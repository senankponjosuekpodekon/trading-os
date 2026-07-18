import { IsEmail, IsString, MaxLength, IsOptional } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(120)
  email: string;

  @IsString()
  @MaxLength(120)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  totpToken?: string;
}
