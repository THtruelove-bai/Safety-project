import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { createClient, RedisClientType } from 'redis';

type OtpPurpose = 'register' | 'login';

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
    return this.createOtp(email, 'register');
  }

  verifyRegisterOtp(email: string, otp: string): Promise<void> {
    return this.verifyOtp(email, otp, 'register');
  }

  createLoginOtp(email: string): Promise<string> {
    return this.createOtp(email, 'login');
  }

  verifyLoginOtp(email: string, otp: string): Promise<void> {
    return this.verifyOtp(email, otp, 'login');
  }

  createEmailOtp(email: string): Promise<string> {
    return this.createRegisterOtp(email);
  }

  verifyEmailOtp(email: string, otp: string): Promise<void> {
    return this.verifyRegisterOtp(email, otp);
  }

  private async createOtp(email: string, purpose: OtpPurpose): Promise<string> {
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttlSeconds = Number(this.configService.get<string>('OTP_TTL_SECONDS', '300'));

    await this.client.set(this.getOtpKey(email, purpose), this.hashOtp(email, otp, purpose), {
      EX: ttlSeconds,
    });

    return otp;
  }

  private async verifyOtp(email: string, otp: string, purpose: OtpPurpose): Promise<void> {
    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('OTP must be a 6 digit code');
    }

    const key = this.getOtpKey(email, purpose);
    const savedHash = await this.client.get(key);

    if (!savedHash || !this.isOtpHashEqual(savedHash, this.hashOtp(email, otp, purpose))) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.client.del(key);
  }

  private getOtpKey(email: string, purpose: OtpPurpose): string {
    return `otp:${purpose}:${email.trim().toLowerCase()}`;
  }

  private hashOtp(email: string, otp: string, purpose: OtpPurpose): string {
    const secret = this.configService.get<string>('OTP_SECRET') ?? this.configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('OTP_SECRET or JWT_SECRET must be configured');
    }

    return createHmac('sha256', secret)
      .update(`${purpose}:${email.trim().toLowerCase()}:${otp}`)
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
}
