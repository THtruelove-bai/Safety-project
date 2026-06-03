import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginRequestOtpDto } from './dto/login-request-otp.dto';
import { LoginVerifyOtpDto } from './dto/login-verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('verify-otp')
  verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('login/request-otp')
  requestLoginOtp(@Body() loginRequestOtpDto: LoginRequestOtpDto) {
    return this.authService.requestLoginOtp(loginRequestOtpDto);
  }

  @Post('login/verify-otp')
  verifyLoginOtp(@Body() loginVerifyOtpDto: LoginVerifyOtpDto) {
    return this.authService.verifyLoginOtp(loginVerifyOtpDto);
  }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
