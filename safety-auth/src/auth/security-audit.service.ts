import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

type SecurityAuditStatus = 'success' | 'failed' | 'blocked';
type SecurityAuditSeverity = 'low' | 'medium' | 'high';

type SecurityAuditEventName =
  | 'auth.register.success'
  | 'auth.register.failed'
  | 'auth.login.password.success'
  | 'auth.login.password.failed'
  | 'auth.otp.verify.success'
  | 'auth.otp.verify.failed'
  | 'auth.otp.resend.success'
  | 'auth.otp.resend.failed'
  | 'auth.otp.resend.blocked'
  | 'auth.otp.attempt.failed'
  | 'auth.otp.locked'
  | 'auth.me.success'
  | 'auth.me.failed'
  | 'auth.legacy_login.blocked'
  | 'auth.rate_limit.exceeded';

type SecurityAuditEvent = {
  event: SecurityAuditEventName;
  status: SecurityAuditStatus;
  severity?: SecurityAuditSeverity;
  username?: string | null;
  email?: string | null;
  ip?: string;
  userAgent?: string;
  reason?: string;
};

@Injectable()
export class SecurityAuditService {
  log(event: SecurityAuditEvent): void {
    const entry = {
      timestamp: new Date().toISOString(),
      source: 'safety-auth',
      category: 'authentication',
      event: event.event,
      status: event.status,
      severity: event.severity ?? this.getDefaultSeverity(event),
      ...(event.username ? { username: event.username } : {}),
      ...(event.email ? { email: event.email } : {}),
      ...(event.ip ? { ip: event.ip } : {}),
      ...(event.userAgent ? { userAgent: event.userAgent } : {}),
      ...(event.reason ? { reason: event.reason } : {}),
    };

    console.log(JSON.stringify(entry));
  }

  metadataFromRequest(
    request: Request,
  ): Pick<SecurityAuditEvent, 'ip' | 'userAgent'> {
    return {
      ip: this.getClientIp(request),
      userAgent: request.get('user-agent'),
    };
  }

  reasonFromError(error: unknown): string {
    const response = this.getErrorResponse(error);
    const message = Array.isArray(response?.message)
      ? response.message.join(' ')
      : response?.message;
    const statusCode = this.getErrorStatus(error);
    const normalized = String(message ?? '').toLowerCase();

    if (
      normalized.includes('invalid username') ||
      normalized.includes('invalid username or password')
    ) {
      return 'invalid_credentials';
    }

    if (normalized.includes('invalid or expired otp')) {
      return 'invalid_or_expired_otp';
    }

    if (normalized.includes('otp must be')) {
      return 'invalid_otp_format';
    }

    if (normalized.includes('bạn nhập sai quá nhiều lần')) {
      return 'otp_locked';
    }

    if (normalized.includes('vui lòng chờ trước khi yêu cầu mã otp mới')) {
      return 'otp_resend_cooldown';
    }

    if (normalized.includes('yêu cầu gửi lại mã quá nhiều lần')) {
      return 'otp_resend_blocked';
    }

    if (normalized.includes('email is already registered')) {
      return 'email_already_registered';
    }

    if (normalized.includes('username is already registered')) {
      return 'username_already_registered';
    }

    if (normalized.includes('email is not verified')) {
      return 'email_not_verified';
    }

    if (normalized.includes('registration expired')) {
      return 'registration_expired';
    }

    if (normalized.includes('could not send verification email')) {
      return 'otp_email_send_failed';
    }

    if (statusCode === 401) {
      return 'unauthorized';
    }

    if (statusCode === 429) {
      return 'rate_limited';
    }

    if (statusCode === 409) {
      return 'conflict';
    }

    return statusCode ? `http_${statusCode}` : 'unknown_error';
  }

  private getDefaultSeverity(event: SecurityAuditEvent): SecurityAuditSeverity {
    if (event.event === 'auth.legacy_login.blocked') {
      return 'high';
    }

    if (event.event === 'auth.rate_limit.exceeded') {
      return 'high';
    }

    if (event.event === 'auth.otp.resend.blocked' || event.event === 'auth.otp.locked') {
      return 'high';
    }

    if (event.event === 'auth.otp.attempt.failed' || event.event === 'auth.otp.resend.failed') {
      return 'medium';
    }

    if (event.status === 'success') {
      return 'low';
    }

    return 'medium';
  }

  private getClientIp(request: Request): string | undefined {
    const forwardedFor = request.get('x-forwarded-for');
    const ip = forwardedFor
      ? forwardedFor.split(',')[0]?.trim()
      : (request.ip ?? request.socket.remoteAddress);

    return ip?.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  }

  private getErrorStatus(error: unknown): number | undefined {
    return error instanceof HttpException ? error.getStatus() : undefined;
  }

  private getErrorResponse(
    error: unknown,
  ): { message?: string | string[] } | undefined {
    if (!(error instanceof HttpException)) {
      return undefined;
    }

    const response = error.getResponse();

    return typeof response === 'object' && response !== null
      ? response
      : undefined;
  }
}
