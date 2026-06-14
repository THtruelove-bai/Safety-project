import { IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class ResendOtpDto {
  @IsIn(['register', 'login'])
  purpose: 'register' | 'login';

  @ValidateIf((dto: ResendOtpDto) => dto.purpose === 'register' || !dto.username)
  @IsEmail()
  email?: string;

  @ValidateIf((dto: ResendOtpDto) => dto.purpose === 'login')
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;
}
