import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../otp/otp.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LoginRequestOtpDto } from './dto/login-request-otp.dto';
import { LoginVerifyOtpDto } from './dto/login-verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

const scrypt = promisify(scryptCallback);

type JwtPayload = {
  sub: string;
  email: string;
};

type AccessTokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto): Promise<{ message: string; userId: string; username: string | null; email: string }> {
    const username = this.usersService.normalizeUsername(registerDto.username);
    const email = this.usersService.normalizeEmail(registerDto.email);
    const passwordHash = await this.hashPassword(registerDto.password);
    const user = await this.usersService.create(username, email, passwordHash);
    const otp = await this.otpService.createRegisterOtp(email);

    await this.mailService.sendOtpEmail(email, otp);

    return {
      message: 'Registration successful. Please verify your email with the OTP sent to your inbox.',
      userId: user.id,
      username: user.username,
      email: user.email,
    };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<{ message: string; email: string }> {
    const email = this.usersService.normalizeEmail(verifyOtpDto.email);

    await this.otpService.verifyRegisterOtp(email, verifyOtpDto.otp);
    const user = await this.usersService.markEmailVerified(email);

    return {
      message: 'Email verified successfully',
      email: user.email,
    };
  }

  async requestLoginOtp(loginRequestOtpDto: LoginRequestOtpDto): Promise<{ message: string; username: string | null; email: string }> {
    const user = await this.validateUserCredentials(
      loginRequestOtpDto.identifier,
      loginRequestOtpDto.password,
    );
    const otp = await this.otpService.createLoginOtp(user.email);

    await this.mailService.sendOtpEmail(user.email, otp);

    return {
      message: 'Login OTP sent to the registered email.',
      username: user.username,
      email: user.email,
    };
  }

  async verifyLoginOtp(loginVerifyOtpDto: LoginVerifyOtpDto): Promise<AccessTokenResponse> {
    const user = await this.findUserByIdentifierOrThrow(loginVerifyOtpDto.identifier);

    await this.otpService.verifyLoginOtp(user.email, loginVerifyOtpDto.otp);

    return this.createAccessTokenResponse(user);
  }

  async login(loginDto: LoginDto): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: string }> {
    const user = await this.validateUserCredentials(loginDto.email, loginDto.password);

    return {
      accessToken: this.signAccessToken(user),
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d'),
    };
  }

  private async validateUserCredentials(identifier: string, password: string): Promise<User> {
    const user = await this.findUserByIdentifierOrThrow(identifier);

    if (!(await this.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid identifier or password');
    }

    if (!user.isEmailVerified) {
      throw new BadRequestException('Email is not verified');
    }

    return user;
  }

  private async findUserByIdentifierOrThrow(identifier: string): Promise<User> {
    const user = await this.usersService.findByIdentifier(identifier);

    if (!user) {
      throw new UnauthorizedException('Invalid identifier or password');
    }

    return user;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const [algorithm, salt, key] = passwordHash.split('$');

    if (algorithm !== 'scrypt' || !salt || !key) {
      return false;
    }

    const savedKey = Buffer.from(key, 'hex');
    const derivedKey = (await scrypt(password, salt, savedKey.length)) as Buffer;

    return savedKey.length === derivedKey.length && timingSafeEqual(savedKey, derivedKey);
  }

  private createAccessTokenResponse(user: User): AccessTokenResponse {
    return {
      access_token: this.signAccessToken(user),
      token_type: 'Bearer',
      expires_in: this.configService.get<string>('JWT_EXPIRES_IN', '1d'),
    };
  }

  private signAccessToken(user: User): string {
    const secret = this.configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET must be configured');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    return jwt.sign(payload, secret, {
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d'),
    });
  }
}
