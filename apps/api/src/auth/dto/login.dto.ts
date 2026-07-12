import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(120)
  email: string;

  @IsString()
  @MaxLength(120)
  password: string;
}
