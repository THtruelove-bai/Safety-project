import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { createClient, RedisClientType } from 'redis';

type OtpPurpose = 'register' | 'login';

export type PendingRegistration = {
  username: string;
  email: string;
  passwordHash: string;
};

export const OTP_LOCKED_MESSAGE =
  'Bạn nhập sai quá nhiều lần, vui lòng đăng nhập lại.';
export const OTP_RESEND_BLOCKED_MESSAGE =
  'Bạn đã yêu cầu gửi lại mã quá nhiều lần. Vui lòng thử lại sau.';
export const OTP_RESEND_COOLDOWN_MESSAGE =
  'Vui lòng chờ trước khi yêu cầu mã OTP mới.';

const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_RESENDS = 5;
const OTP_SESSION_TTL_SECONDS = 15 * 60;
const RESEND_COOLDOWNS_SECONDS = [60, 60, 180, 300, 600];

@Injectable()
export class OtpService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.client = createClient({
      socket: {
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: Number(this.configService.get<string>('REDIS_PORT', '6379')),
      },
      password: this.configService.get<string>('REDIS_PASSWORD'),
    });

    this.client.on('error', (error) => {
      console.error('Redis OTP client error', error);
    });

    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  createRegisterOtp(email: string): Promise<string> {
    return this.createOtp(email, 'register', true);
  }

  verifyRegisterOtp(email: string, otp: string): Promise<void> {
    return this.verifyOtp(email, otp, 'register');
  }

  async deleteRegisterOtp(email: string): Promise<void> {
    await this.client.del(this.getOtpKey(email, 'register'));
  }

  createLoginOtp(email: string): Promise<string> {
    return this.createOtp(email, 'login', true);
  }

  async deleteLoginOtp(email: string): Promise<void> {
    await this.client.del(this.getOtpKey(email, 'login'));
  }

  verifyLoginOtp(email: string, otp: string): Promise<void> {
    return this.verifyOtp(email, otp, 'login');
  }

  resendOtp(email: string, purpose: OtpPurpose): Promise<string> {
    return this.resendOtpForPurpose(email, purpose);
  }

  async savePendingRegistration(pendingRegistration: PendingRegistration): Promise<void> {
    await this.client.set(
      this.getPendingRegistrationKey(pendingRegistration.email),
      JSON.stringify(pendingRegistration),
      { EX: OTP_SESSION_TTL_SECONDS },
    );
  }

  async getPendingRegistration(email: string): Promise<PendingRegistration | null> {
    const value = await this.client.get(this.getPendingRegistrationKey(email));

    if (!value) {
      return null;
    }

    return JSON.parse(value) as PendingRegistration;
  }

  async deletePendingRegistration(email: string): Promise<void> {
    await this.client.del(this.getPendingRegistrationKey(email));
  }

  createEmailOtp(email: string): Promise<string> {
    return this.createRegisterOtp(email);
  }

  verifyEmailOtp(email: string, otp: string): Promise<void> {
    return this.verifyRegisterOtp(email, otp);
  }

  private async createOtp(
    email: string,
    purpose: OtpPurpose,
    resetResendSession: boolean,
  ): Promise<string> {
    const normalizedEmail = this.normalizeEmail(email);
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.client.set(
      this.getOtpKey(normalizedEmail, purpose),
      this.hashOtp(normalizedEmail, otp, purpose),
      { EX: this.getOtpTtlSeconds() },
    );

    await this.resetAttempts(normalizedEmail, purpose);

    if (resetResendSession) {
      await this.resetResendSession(normalizedEmail, purpose);
    }

    return otp;
  }

  private async resendOtpForPurpose(
    email: string,
    purpose: OtpPurpose,
  ): Promise<string> {
    const normalizedEmail = this.normalizeEmail(email);
    const cooldownKey = this.getResendCooldownKey(normalizedEmail, purpose);
    const retryAfterSeconds = await this.client.ttl(cooldownKey);

    if (retryAfterSeconds > 0) {
      throw new HttpException({
        message: OTP_RESEND_COOLDOWN_MESSAGE,
        retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const countKey = this.getResendCountKey(normalizedEmail, purpose);
    const resendCount = await this.client.incr(countKey);

    if (resendCount === 1) {
      await this.client.expire(countKey, OTP_SESSION_TTL_SECONDS);
    }

    if (resendCount > OTP_MAX_RESENDS) {
      await this.client.expire(countKey, OTP_SESSION_TTL_SECONDS);
      throw new HttpException({
        message: OTP_RESEND_BLOCKED_MESSAGE,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const otp = await this.createOtp(normalizedEmail, purpose, false);
    const cooldownSeconds = RESEND_COOLDOWNS_SECONDS[resendCount - 1] ?? 600;
    await this.client.set(cooldownKey, String(resendCount), {
      EX: cooldownSeconds,
    });

    return otp;
  }

  private async verifyOtp(email: string, otp: string, purpose: OtpPurpose): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('OTP must be a 6 digit code');
    }

    if (await this.isLocked(normalizedEmail, purpose)) {
      throw new HttpException({ message: OTP_LOCKED_MESSAGE }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const key = this.getOtpKey(normalizedEmail, purpose);
    const savedHash = await this.client.get(key);

    if (!savedHash) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    if (!this.isOtpHashEqual(savedHash, this.hashOtp(normalizedEmail, otp, purpose))) {
      await this.recordFailedAttempt(normalizedEmail, purpose);
      return;
    }

    await this.client.del(key);
    await this.resetAttempts(normalizedEmail, purpose);
  }

  private async recordFailedAttempt(
    email: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const attemptsKey = this.getAttemptsKey(email, purpose);
    const attempts = await this.client.incr(attemptsKey);
    const otpTtl = await this.client.ttl(this.getOtpKey(email, purpose));

    if (attempts === 1) {
      await this.client.expire(
        attemptsKey,
        otpTtl > 0 ? otpTtl : this.getOtpTtlSeconds(),
      );
    }

    if (attempts >= OTP_MAX_ATTEMPTS) {
      await this.client.del(this.getOtpKey(email, purpose));
      await this.client.set(this.getLockKey(email, purpose), '1', {
        EX: OTP_SESSION_TTL_SECONDS,
      });
      throw new HttpException({ message: OTP_LOCKED_MESSAGE }, HttpStatus.TOO_MANY_REQUESTS);
    }

    throw new BadRequestException('Invalid or expired OTP');
  }

  private async isLocked(email: string, purpose: OtpPurpose): Promise<boolean> {
    return (await this.client.exists(this.getLockKey(email, purpose))) === 1;
  }

  private async resetAttempts(email: string, purpose: OtpPurpose): Promise<void> {
    await this.client.del(
      [this.getAttemptsKey(email, purpose), this.getLockKey(email, purpose)],
    );
  }

  private async resetResendSession(email: string, purpose: OtpPurpose): Promise<void> {
    await this.client.del(
      [this.getResendCountKey(email, purpose), this.getResendCooldownKey(email, purpose)],
    );
  }

  private getOtpTtlSeconds(): number {
    return Number(this.configService.get<string>('OTP_TTL_SECONDS', '60'));
  }

  private getOtpKey(email: string, purpose: OtpPurpose): string {
    return `otp:${purpose}:${this.normalizeEmail(email)}`;
  }

  private getAttemptsKey(email: string, purpose: OtpPurpose): string {
    return `otp:attempts:${purpose}:${this.normalizeEmail(email)}`;
  }

  private getLockKey(email: string, purpose: OtpPurpose): string {
    return `otp:locked:${purpose}:${this.normalizeEmail(email)}`;
  }

  private getResendCountKey(email: string, purpose: OtpPurpose): string {
    return `otp:resend:${purpose}:${this.normalizeEmail(email)}`;
  }

  private getResendCooldownKey(email: string, purpose: OtpPurpose): string {
    return `otp:resend:cooldown:${purpose}:${this.normalizeEmail(email)}`;
  }

  private getPendingRegistrationKey(email: string): string {
    return `pending:register:${this.normalizeEmail(email)}`;
  }

  private hashOtp(email: string, otp: string, purpose: OtpPurpose): string {
    const secret = this.configService.get<string>('OTP_SECRET') ?? this.configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('OTP_SECRET or JWT_SECRET must be configured');
    }

    return createHmac('sha256', secret)
      .update(`${purpose}:${this.normalizeEmail(email)}:${otp}`)
      .digest('hex');
  }

  private isOtpHashEqual(savedHash: string, candidateHash: string): boolean {
    const savedBuffer = Buffer.from(savedHash, 'hex');
    const candidateBuffer = Buffer.from(candidateHash, 'hex');

    return (
      savedBuffer.length === candidateBuffer.length &&
      timingSafeEqual(savedBuffer, candidateBuffer)
    );
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
