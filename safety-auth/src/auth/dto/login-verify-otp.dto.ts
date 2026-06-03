import { IsString, Matches, MinLength } from 'class-validator';

export class LoginVerifyOtpDto {
  @IsString()
  @MinLength(3)
  username: string;

  @Matches(/^\d{6}$/)
  otp: string;
}
