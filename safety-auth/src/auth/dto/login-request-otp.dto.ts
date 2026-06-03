import { IsString, MinLength } from 'class-validator';

export class LoginRequestOtpDto {
  @IsString()
  @MinLength(3)
  identifier: string;

  @IsString()
  password: string;
}
