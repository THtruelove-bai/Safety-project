import { IsString, MinLength } from 'class-validator';

export class LoginRequestOtpDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  password: string;
}
