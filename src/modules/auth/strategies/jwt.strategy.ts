import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '../../../common/decorators/roles.decorator';
import type { CurrentAuthUser } from '../../../common/decorators/current-user.decorator';
import type { RequestWithCookies } from '../../../common/types';
import { AppConfig, configuration } from '../../../config/configuration';
import { UserStatus } from '../../../db/schema';
import { UsersService } from '../../users/users.service';
import { ACCESS_TOKEN_COOKIE } from '../cookies';

interface AccessTokenPayload {
  sub: string;
  role: Role;
  sessionVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(configuration.KEY) cfg: AppConfig,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => (req as RequestWithCookies).cookies?.[ACCESS_TOKEN_COOKIE] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtAccessSecret,
    });
  }

  // validate 时从 DB 取用户，保证封禁即时生效
  async validate(payload: AccessTokenPayload): Promise<CurrentAuthUser> {
    if (!payload || typeof payload.sub !== 'string' || !Number.isInteger(payload.sessionVersion)) {
      throw new UnauthorizedException('未登录或登录已过期');
    }
    const user = await this.usersService.getAuthUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException('未登录或登录已过期');
    }
    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('账号已被封禁');
    }
    if (payload.sessionVersion !== user.sessionVersion || payload.role !== user.role) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }
    return { id: user.id, role: user.role, email: user.email };
  }
}
