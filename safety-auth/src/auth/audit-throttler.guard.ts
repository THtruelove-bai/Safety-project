import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { SecurityAuditService } from './security-audit.service';

@Injectable()
export class AuditThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly securityAudit: SecurityAuditService,
  ) {
    super(options, storageService, reflector);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>();

    this.securityAudit.log({
      event: 'auth.rate_limit.exceeded',
      status: 'blocked',
      severity: 'high',
      ...this.securityAudit.metadataFromRequest(request),
      reason: 'too_many_requests',
    });

    throw new HttpException(
      { message: 'Bạn thao tác quá nhiều lần. Vui lòng chờ một chút rồi thử lại.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
