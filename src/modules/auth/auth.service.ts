import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { v7 as uuidv7 } from 'uuid';
import { Role } from '../../common/decorators/roles.decorator';
import { AppConfig, configuration } from '../../config/configuration';
import {
  REDIS_CLIENT,
  REFRESH_TOKEN_STORE,
  RedisClient,
  RefreshTokenStore,
} from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { InviteCodesService } from '../admin/invite-codes.service';
import { UsersService, normalizeIdentifier } from '../users/users.service';
import { UserSelf } from '../users/users.views';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AuthTokens,
  REFRESH_TOKEN_TTL_SECONDS,
} from './cookies';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RedeemInviteCodeDto } from './dto/redeem-invite-code.dto';
import { RegisterDto } from './dto/register.dto';
import { hashPassword, verifyPassword } from './password';

const LOGIN_FAIL_TTL_SECONDS = 15 * 60;
const LOGIN_FAIL_LIMIT = 5;

interface RefreshPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly inviteCodesService: InviteCodesService,
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshStore: RefreshTokenStore,
    @Inject(configuration.KEY) private readonly cfg: AppConfig,
  ) {}

  private loginFailKey(identifier: string, ip: string): string {
    return `login_fail:${identifier}:${ip}`;
  }

  private async issueTokens(userId: string, role: Role): Promise<AuthTokens> {
    const jti = uuidv7();
    const accessToken = this.jwtService.sign(
      { sub: userId, role },
      { secret: this.cfg.jwtAccessSecret, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    const refreshToken = this.jwtService.sign(
      { sub: userId, jti },
      { secret: this.cfg.jwtRefreshSecret, expiresIn: REFRESH_TOKEN_TTL_SECONDS },
    );
    await this.refreshStore.register(userId, jti, REFRESH_TOKEN_TTL_SECONDS);
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto): Promise<{ user: UserSelf; tokens: AuthTokens }> {
    const identifier = normalizeIdentifier(dto.identifier);
    const isEmailIdentifier = identifier.includes('@');
    const passwordHash = await hashPassword(dto.password);
    // 有码 → MEMBER 并核销；无码 → VISITOR（7 天清理对象）
    const invite = dto.inviteCode ? await this.inviteCodesService.consume(dto.inviteCode) : null;
    let user: UserSelf;
    try {
      user = await this.usersService.createUser({
        email: isEmailIdentifier ? identifier : null,
        phone: isEmailIdentifier ? null : identifier,
        passwordHash,
        nickname: dto.nickname,
        role: invite ? Role.MEMBER : Role.VISITOR,
        inviteCodeId: invite ? invite.id : null,
      });
    } catch (error) {
      // 落库失败（如邮箱已注册）时回退核销计数
      if (invite) {
        await this.inviteCodesService.release(invite.id);
      }
      throw error;
    }
    const tokens = await this.issueTokens(user.id, user.role);
    return { user, tokens };
  }

  /** 持码转正：VISITOR 提交邀请码 → MEMBER（核销一人名额），并换发双 token */
  async redeemInviteCode(
    userId: string,
    dto: RedeemInviteCodeDto,
  ): Promise<{ user: UserSelf; tokens: AuthTokens }> {
    const authUser = await this.usersService.getAuthUser(userId);
    if (!authUser) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (authUser.role !== Role.VISITOR) {
      throw new ForbiddenException('仅临时访客可使用邀请码转正');
    }
    const invite = await this.inviteCodesService.consume(dto.inviteCode);
    let user: UserSelf;
    try {
      user = await this.usersService.applyInviteCode(userId, invite.id);
    } catch (error) {
      // 转正落库失败（如并发下角色已变更）时回退核销计数
      await this.inviteCodesService.release(invite.id);
      throw error;
    }
    // 角色变更，旧 token 全部作废并换发新的
    await this.refreshStore.revokeAll(userId);
    const tokens = await this.issueTokens(user.id, user.role);
    return { user, tokens };
  }

  async login(
    dto: LoginDto,
    ip: string,
  ): Promise<{ user: UserSelf; tokens: AuthTokens }> {
    const identifier = dto.identifier.trim();
    const failKey = this.loginFailKey(identifier, ip);
    const failCount = Number((await this.redis.get(failKey)) ?? '0');
    if (failCount >= LOGIN_FAIL_LIMIT) {
      throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    const record = await this.usersService.findByIdentifier(identifier);
    const passwordOk =
      record !== null && (await verifyPassword(record.passwordHash, dto.password));
    if (!record || !passwordOk) {
      const failures = await this.redis.incr(failKey);
      if (failures === 1) {
        await this.redis.expire(failKey, LOGIN_FAIL_TTL_SECONDS);
      }
      if (failures >= LOGIN_FAIL_LIMIT) {
        throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
      }
      // 统一文案，不区分用户不存在与密码错误
      throw new UnauthorizedException('账号或密码错误');
    }

    await this.redis.del(failKey);
    if (record.status === UserStatus.BANNED) {
      throw new ForbiddenException('账号已被封禁');
    }
    const user = await this.usersService.getSelf(record.id);
    const tokens = await this.issueTokens(record.id, record.role);
    return { user, tokens };
  }

  async refresh(refreshToken: string | undefined): Promise<{ user: UserSelf; tokens: AuthTokens }> {
    if (!refreshToken) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: this.cfg.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (!payload || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const known = await this.refreshStore.has(payload.sub, payload.jti);
    if (!known) {
      // 已删除的 jti 被复用：视为 token 窃取，清空该用户全部 refresh 并强制重登
      await this.refreshStore.revokeAll(payload.sub);
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }
    await this.refreshStore.revoke(payload.sub, payload.jti);

    const authUser = await this.usersService.getAuthUser(payload.sub);
    if (!authUser) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (authUser.status === UserStatus.BANNED) {
      throw new ForbiddenException('账号已被封禁');
    }
    const tokens = await this.issueTokens(authUser.id, authUser.role);
    const user = await this.usersService.getSelf(authUser.id);
    return { user, tokens };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    try {
      const payload = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: this.cfg.jwtRefreshSecret,
      });
      if (payload && typeof payload.sub === 'string') {
        await this.refreshStore.revokeAll(payload.sub);
      }
    } catch {
      // 无效 refresh token 视为已登出
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const record = await this.usersService.getAuthRecordById(userId);
    if (!record) {
      throw new NotFoundException('用户不存在');
    }
    const ok = await verifyPassword(record.passwordHash, dto.currentPassword);
    if (!ok) {
      throw new BadRequestException('当前密码错误');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.usersService.updatePasswordHash(userId, passwordHash);
    await this.refreshStore.revokeAll(userId);
  }

  async getMe(userId: string): Promise<UserSelf> {
    return this.usersService.getSelf(userId);
  }
}
