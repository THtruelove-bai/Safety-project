import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

type JwtPayload = {
  sub: string;
  email: string;
};

export type AuthenticatedUser = {
  id: string;
  username: string | null;
  email: string;
  isEmailVerified: boolean;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET must be configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findById(payload.sub);

    if (!user || user.email !== payload.email) {
      throw new UnauthorizedException('Invalid token subject');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    };
  }
}
