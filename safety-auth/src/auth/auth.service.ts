import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
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
import { ResendOtpDto } from './dto/resend-otp.dto';

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

  async register(
    registerDto: RegisterDto,
  ): Promise<{ message: string; username: string; email: string }> {
    const username = this.usersService.normalizeUsername(registerDto.username);
    const email = this.usersService.normalizeEmail(registerDto.email);

    await this.assertRegistrationAvailable(username, email);

    const passwordHash = await this.hashPassword(registerDto.password);
    const otp = await this.otpService.createRegisterOtp(email);

    await this.otpService.savePendingRegistration({
      username,
      email,
      passwordHash,
    });

    try {
      await this.mailService.sendOtpEmail(email, otp);
    } catch {
      await this.otpService.deletePendingRegistration(email);
      await this.otpService.deleteRegisterOtp(email);
      throw new BadRequestException(
        'Could not send verification email. Please try again later.',
      );
    }

    return {
      message:
        'Registration OTP sent. Please verify your email to finish creating your Safety account.',
      username,
      email,
    };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<AccessTokenResponse> {
    const email = this.usersService.normalizeEmail(verifyOtpDto.email);

    await this.otpService.verifyRegisterOtp(email, verifyOtpDto.otp);

    const pendingRegistration =
      await this.otpService.getPendingRegistration(email);

    if (!pendingRegistration) {
      throw new BadRequestException(
        'Registration expired. Please register again.',
      );
    }

    await this.assertRegistrationAvailable(
      pendingRegistration.username,
      pendingRegistration.email,
    );

    const user = await this.usersService.createVerified(
      pendingRegistration.username,
      pendingRegistration.email,
      pendingRegistration.passwordHash,
    );

    await this.otpService.deletePendingRegistration(email);

    return this.createAccessTokenResponse(user);
  }

  async requestLoginOtp(
    loginRequestOtpDto: LoginRequestOtpDto,
  ): Promise<{ message: string; username: string | null; email: string }> {
    const user = await this.validateUserCredentials(
      loginRequestOtpDto.username,
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

  async verifyLoginOtp(
    loginVerifyOtpDto: LoginVerifyOtpDto,
  ): Promise<AccessTokenResponse> {
    const user = await this.findUserByIdentifierOrThrow(
      loginVerifyOtpDto.username,
    );

    await this.otpService.verifyLoginOtp(user.email, loginVerifyOtpDto.otp);

    return this.createAccessTokenResponse(user);
  }


  async resendOtp(
    resendOtpDto: ResendOtpDto,
  ): Promise<{ message: string; purpose: 'register' | 'login'; email: string; username?: string | null }> {
    if (resendOtpDto.purpose === 'register') {
      const email = this.usersService.normalizeEmail(resendOtpDto.email ?? '');
      const existingUser = await this.usersService.findByEmail(email);

      if (existingUser?.isEmailVerified) {
        throw new BadRequestException('This email is already verified.');
      }

      const pendingRegistration = await this.otpService.getPendingRegistration(email);

      if (!pendingRegistration) {
        throw new BadRequestException('Registration expired. Please register again.');
      }

      const otp = await this.otpService.resendOtp(email, 'register');

      try {
        await this.mailService.sendOtpEmail(email, otp);
      } catch {
        throw new BadRequestException(
          'Could not send verification email. Please try again later.',
        );
      }

      return {
        message: 'Mã OTP mới đã được gửi.',
        purpose: 'register',
        email,
        username: pendingRegistration.username,
      };
    }

    const identifier = resendOtpDto.username || resendOtpDto.email || '';
    const user = await this.findUserByIdentifierOrThrow(identifier);

    if (!user.isEmailVerified) {
      throw new BadRequestException('Email is not verified');
    }

    const otp = await this.otpService.resendOtp(user.email, 'login');

    try {
      await this.mailService.sendOtpEmail(user.email, otp);
    } catch {
      throw new BadRequestException(
        'Could not send verification email. Please try again later.',
      );
    }

    return {
      message: 'Mã OTP mới đã được gửi.',
      purpose: 'login',
      email: user.email,
      username: user.username,
    };
  }

  async login(
    loginDto: LoginDto,
  ): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: string }> {
    const user = await this.validateUserCredentials(
      loginDto.email,
      loginDto.password,
    );

    return {
      accessToken: this.signAccessToken(user),
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d'),
    };
  }

  private async assertRegistrationAvailable(
    username: string,
    email: string,
  ): Promise<void> {
    const existingEmail = await this.usersService.findByEmail(email);

    if (existingEmail) {
      if (existingEmail.isEmailVerified) {
        throw new ConflictException('Email is already registered');
      }

      throw new ConflictException(
        'Email has an unverified registration from the previous flow. Remove it in development or use a different email.',
      );
    }

    const existingUsername = await this.usersService.findByUsername(username);

    if (existingUsername) {
      if (existingUsername.isEmailVerified) {
        throw new ConflictException('Username is already registered');
      }

      throw new ConflictException(
        'Username has an unverified registration from the previous flow. Remove it in development or use a different username.',
      );
    }
  }

  private async validateUserCredentials(
    identifier: string,
    password: string,
  ): Promise<User> {
    const user = await this.findUserByIdentifierOrThrow(identifier);

    if (!(await this.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid username or password');
    }

    if (!user.isEmailVerified) {
      throw new BadRequestException('Email is not verified');
    }

    return user;
  }

  private async findUserByIdentifierOrThrow(identifier: string): Promise<User> {
    const user = await this.usersService.findByIdentifier(identifier);

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return user;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(
    password: string,
    passwordHash: string,
  ): Promise<boolean> {
    const [algorithm, salt, key] = passwordHash.split('$');

    if (algorithm !== 'scrypt' || !salt || !key) {
      return false;
    }

    const savedKey = Buffer.from(key, 'hex');
    const derivedKey = (await scrypt(
      password,
      salt,
      savedKey.length,
    )) as Buffer;

    return (
      savedKey.length === derivedKey.length &&
      timingSafeEqual(savedKey, derivedKey)
    );
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

    const signOptions: SignOptions = {
      expiresIn: this.configService.get<string>(
        'JWT_EXPIRES_IN',
        '1d',
      ) as SignOptions['expiresIn'],
    };

    return jwt.sign(payload, secret, signOptions);
  }
}
