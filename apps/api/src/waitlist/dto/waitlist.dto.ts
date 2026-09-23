import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWaitlistDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(190)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  opinion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contribution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  objectives?: string;
}
