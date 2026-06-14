import {
  Body,
  Controller,
  Get,
  GoneException,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './jwt.strategy';
import { LoginRequestOtpDto } from './dto/login-request-otp.dto';
import { LoginVerifyOtpDto } from './dto/login-verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { SecurityAuditService } from './security-audit.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  async register(@Body() registerDto: RegisterDto, @Req() request: Request) {
    try {
      const response = await this.authService.register(registerDto);

      this.securityAudit.log({
        event: 'auth.register.success',
        status: 'success',
        username: response.username,
        email: response.email,
        ...this.securityAudit.metadataFromRequest(request),
      });

      return response;
    } catch (error) {
      this.securityAudit.log({
        event: 'auth.register.failed',
        status: 'failed',
        username: registerDto.username,
        email: registerDto.email,
        ...this.securityAudit.metadataFromRequest(request),
        reason: this.securityAudit.reasonFromError(error),
      });

      throw error;
    }
  }

  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post('verify-otp')
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto, @Req() request: Request) {
    try {
      const response = await this.authService.verifyOtp(verifyOtpDto);

      this.securityAudit.log({
        event: 'auth.otp.verify.success',
        status: 'success',
        email: verifyOtpDto.email,
        ...this.securityAudit.metadataFromRequest(request),
      });

      return response;
    } catch (error) {
      this.logOtpVerifyFailure({
        error,
        request,
        email: verifyOtpDto.email,
      });

      throw error;
    }
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/request-otp')
  async requestLoginOtp(
    @Body() loginRequestOtpDto: LoginRequestOtpDto,
    @Req() request: Request,
  ) {
    try {
      const response =
        await this.authService.requestLoginOtp(loginRequestOtpDto);

      this.securityAudit.log({
        event: 'auth.login.password.success',
        status: 'success',
        username: response.username,
        email: response.email,
        ...this.securityAudit.metadataFromRequest(request),
      });

      return response;
    } catch (error) {
      this.securityAudit.log({
        event: 'auth.login.password.failed',
        status: 'failed',
        username: loginRequestOtpDto.username,
        ...this.securityAudit.metadataFromRequest(request),
        reason: this.securityAudit.reasonFromError(error),
      });

      throw error;
    }
  }

  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post('login/verify-otp')
  async verifyLoginOtp(
    @Body() loginVerifyOtpDto: LoginVerifyOtpDto,
    @Req() request: Request,
  ) {
    try {
      const response = await this.authService.verifyLoginOtp(loginVerifyOtpDto);

      this.securityAudit.log({
        event: 'auth.otp.verify.success',
        status: 'success',
        username: loginVerifyOtpDto.username,
        ...this.securityAudit.metadataFromRequest(request),
      });

      return response;
    } catch (error) {
      this.logOtpVerifyFailure({
        error,
        request,
        username: loginVerifyOtpDto.username,
      });

      throw error;
    }
  }


  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('resend-otp')
  async resendOtp(@Body() resendOtpDto: ResendOtpDto, @Req() request: Request) {
    try {
      const response = await this.authService.resendOtp(resendOtpDto);

      this.securityAudit.log({
        event: 'auth.otp.resend.success',
        status: 'success',
        username: response.username,
        email: response.email,
        ...this.securityAudit.metadataFromRequest(request),
      });

      return response;
    } catch (error) {
      const isBlocked = error instanceof HttpException && error.getStatus() === 429;

      this.securityAudit.log({
        event: isBlocked ? 'auth.otp.resend.blocked' : 'auth.otp.resend.failed',
        status: isBlocked ? 'blocked' : 'failed',
        severity: isBlocked ? 'high' : 'medium',
        username: resendOtpDto.username,
        email: resendOtpDto.email,
        ...this.securityAudit.metadataFromRequest(request),
        reason: this.securityAudit.reasonFromError(error),
      });

      throw error;
    }
  }

  @Post('login')
  login(@Body() loginDto: LoginDto, @Req() request: Request): never {
    this.securityAudit.log({
      event: 'auth.legacy_login.blocked',
      status: 'blocked',
      email: loginDto.email,
      ...this.securityAudit.metadataFromRequest(request),
      reason: 'legacy_password_only_login_disabled',
    });

    throw new GoneException(
      'Legacy password-only login is disabled. Please use OTP login flow.',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest): AuthenticatedUser {
    this.securityAudit.log({
      event: 'auth.me.success',
      status: 'success',
      username: request.user.username,
      email: request.user.email,
      ...this.securityAudit.metadataFromRequest(request),
    });

    return request.user;
  }
  private logOtpVerifyFailure({
    error,
    request,
    username,
    email,
  }: {
    error: unknown;
    request: Request;
    username?: string;
    email?: string;
  }): void {
    const reason = this.securityAudit.reasonFromError(error);
    const isLocked = reason === 'otp_locked';

    this.securityAudit.log({
      event: isLocked ? 'auth.otp.locked' : 'auth.otp.attempt.failed',
      status: isLocked ? 'blocked' : 'failed',
      severity: isLocked ? 'high' : 'medium',
      username,
      email,
      ...this.securityAudit.metadataFromRequest(request),
      reason,
    });
  }

}
