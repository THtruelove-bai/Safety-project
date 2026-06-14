import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOtpEmail(email: string, otp: string): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: Number(this.configService.get<string>('MAIL_PORT', '587')),
      secure: this.configService.get<string>('MAIL_SECURE', 'false') === 'true',
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASSWORD'),
      },
    });

    try {
      await transporter.sendMail({
        from: this.getFromAddress(),
        to: email,
        subject: 'Safety verification code',
        text: `Your Safety verification code is ${otp}. It expires soon.`,
        html: `<p>Your Safety verification code is <strong>${otp}</strong>.</p><p>It expires soon.</p>`,
      });
    } catch (error) {
      this.logger.error({
        event: 'mail.otp.send.failed',
        smtp: this.getSafeSmtpError(error),
      });

      throw error;
    }
  }

  private getFromAddress(): string {
    const name = this.configService.get<string>('MAIL_FROM_NAME', 'Safety');
    const email = this.configService.get<string>('MAIL_FROM_EMAIL');

    return `"${name}" <${email}>`;
  }

  private getSafeSmtpError(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object') {
      return {
        message: String(error),
      };
    }

    const smtpError = error as {
      name?: unknown;
      code?: unknown;
      command?: unknown;
      responseCode?: unknown;
      response?: unknown;
      message?: unknown;
    };

    return {
      name: smtpError.name,
      code: smtpError.code,
      command: smtpError.command,
      responseCode: smtpError.responseCode,
      response: smtpError.response,
      message: smtpError.message,
    };
  }
}
