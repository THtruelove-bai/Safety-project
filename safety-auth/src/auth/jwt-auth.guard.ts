import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { AuthenticatedUser } from './jwt.strategy';
import { SecurityAuditService } from './security-audit.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly securityAudit: SecurityAuditService) {
    super();
  }

  handleRequest<TUser = AuthenticatedUser>(
    error: Error | null,
    user: TUser | false,
    info: Error | null,
    context: ExecutionContext,
  ): TUser {
    if (error || !user) {
      const request = context.switchToHttp().getRequest<Request>();

      this.securityAudit.log({
        event: 'auth.me.failed',
        status: 'failed',
        ...this.securityAudit.metadataFromRequest(request),
        reason:
          info?.name === 'TokenExpiredError' ? 'token_expired' : 'unauthorized',
      });

      throw error || new UnauthorizedException('Unauthorized');
    }

    return user;
  }
}
