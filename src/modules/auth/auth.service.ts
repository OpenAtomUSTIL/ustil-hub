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
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppConfig, configuration } from '../../config/configuration';
import {
  REDIS_CLIENT,
  REFRESH_TOKEN_STORE,
  RedisClient,
  RefreshTokenStore,
} from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { InviteCodesService } from '../admin/invite-codes.service';
import { CaptchaService } from '../captcha/captcha.service';
import { LoginLogsService } from '../audit/login-logs.service';
import { EmailCodeService } from '../mail/email-code.service';
import { ResetTokenStore, verifyUnsubscribeToken } from '../mail/link-tokens';
import { RESET_TOKEN_STORE } from '../mail/mail.module';
import { MailService } from '../mail/mail.service';
import { UsersService, normalizeIdentifier } from '../users/users.service';
import { AuthUser, UserPublic, UserSelf } from '../users/users.views';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AuthTokens,
  REFRESH_TOKEN_TTL_SECONDS,
} from './cookies';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailCodeDto } from './dto/email-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RedeemInviteCodeDto } from './dto/redeem-invite-code.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';
import { hashPassword, verifyPassword } from './password';

const LOGIN_FAIL_TTL_SECONDS = 15 * 60;
const LOGIN_FAIL_LIMIT = 5;

interface RefreshPayload {
  sub: string;
  jti: string;
  sessionVersion: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly inviteCodesService: InviteCodesService,
    private readonly loginLogsService: LoginLogsService,
    private readonly captchaService: CaptchaService,
    private readonly emailCodeService: EmailCodeService,
    private readonly mailService: MailService,
    private readonly crypto: CryptoService,
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshStore: RefreshTokenStore,
    @Inject(RESET_TOKEN_STORE) private readonly resetTokens: ResetTokenStore,
    @Inject(configuration.KEY) private readonly cfg: AppConfig,
  ) {}

  private loginFailKey(identifier: string, ip: string): string {
    return `login_fail:${identifier}:${ip}`;
  }

  private normalizeUserAgent(userAgent: string | null | undefined): string | null {
    const trimmed = userAgent?.trim();
    return trimmed ? trimmed.slice(0, 500) : null;
  }

  // 登录日志：只写标识与结果，不写密码等敏感信息
  private async logLogin(input: {
    userId: string | null;
    email: string;
    ip: string;
    userAgent: string | null | undefined;
    success: boolean;
    failReason?: string;
  }): Promise<void> {
    await this.loginLogsService.record({
      userId: input.userId,
      email: input.email,
      ip: input.ip,
      userAgent: this.normalizeUserAgent(input.userAgent),
      success: input.success,
      failReason: input.failReason ?? null,
    });
  }

  private signTokens(user: AuthUser, jti: string): AuthTokens {
    const accessToken = this.jwtService.sign(
      { sub: user.id, role: user.role, sessionVersion: user.sessionVersion },
      { secret: this.cfg.jwtAccessSecret, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti, sessionVersion: user.sessionVersion },
      { secret: this.cfg.jwtRefreshSecret, expiresIn: REFRESH_TOKEN_TTL_SECONDS },
    );
    return { accessToken, refreshToken };
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const user = await this.usersService.getAuthUser(userId);
    if (!user) throw new UnauthorizedException('登录已过期，请重新登录');
    if (user.status === UserStatus.BANNED) throw new ForbiddenException('账号已被封禁');
    const jti = uuidv7();
    const tokens = this.signTokens(user, jti);
    await this.refreshStore.register(userId, jti, REFRESH_TOKEN_TTL_SECONDS);
    return tokens;
  }

  async register(dto: RegisterDto, ip = 'unknown'): Promise<{ user: UserSelf; tokens: AuthTokens }> {
    // 先限制尝试次数，再执行 Argon2；计数和过期必须原子设置，失败请求也占预算。
    const attempts = Number(await this.redis.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return count`,
      1, `register_attempt:${ip}`, 15 * 60,
    ));
    if (attempts > 10) {
      throw new HttpException('注册尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.captchaService.validate(dto.captchaId, dto.captchaCode);
    // v12.0：仅邮箱注册 + 强制邮箱验证（邮件验证码，一次性消费）
    const identifier = normalizeIdentifier(dto.identifier);
    await this.emailCodeService.check(identifier, 'register', dto.emailCode);
    const passwordHash = await hashPassword(dto.password);
    // 有码 → MEMBER 并核销；无码 → VISITOR（7 天清理对象）
    const invite = dto.inviteCode ? await this.inviteCodesService.consume(dto.inviteCode) : null;
    let user: UserSelf;
    try {
      // 邀请码通过后再原子消费邮件码；邀请码错误可使用原邮件码重试。
      await this.emailCodeService.validate(identifier, 'register', dto.emailCode);
      user = await this.usersService.createUser({
        email: identifier,
        phone: null,
        passwordHash,
        nickname: dto.nickname,
        role: invite ? Role.MEMBER : Role.VISITOR,
        inviteCodeId: invite ? invite.id : null,
        emailVerifiedAt: new Date(),
      });
    } catch (error) {
      // 落库失败（如邮箱已注册）时回退核销计数
      if (invite) {
        await this.inviteCodesService.release(invite.id);
      }
      throw error;
    }
    const tokens = await this.issueTokens(user.id);
    return { user, tokens };
  }

  /** 持码转正：VISITOR 提交邀请码 → MEMBER（核销一人名额），并换发双 token */
  async redeemInviteCode(
    userId: string,
    dto: RedeemInviteCodeDto,
  ): Promise<{ user: UserSelf; tokens: AuthTokens }> {
    await this.captchaService.validate(dto.captchaId, dto.captchaCode);
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
    const tokens = await this.issueTokens(user.id);
    return { user, tokens };
  }

  async login(
    dto: LoginDto,
    ip: string,
    userAgent?: string | null,
  ): Promise<{ user: UserSelf; tokens: AuthTokens }> {
    const identifier = normalizeIdentifier(dto.identifier);
    const failKey = this.loginFailKey(identifier, ip);
    const failCount = Number((await this.redis.get(failKey)) ?? '0');
    if (failCount >= LOGIN_FAIL_LIMIT) {
      await this.logLogin({
        userId: null,
        email: identifier,
        ip,
        userAgent,
        success: false,
        failReason: '登录尝试过于频繁',
      });
      throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.captchaService.validate(dto.captchaId, dto.captchaCode);

    const record = await this.usersService.findByIdentifier(identifier);
    const passwordOk =
      record !== null && (await verifyPassword(record.passwordHash, dto.password));
    if (!record || !passwordOk) {
      const failures = await this.redis.incr(failKey);
      if (failures === 1) {
        await this.redis.expire(failKey, LOGIN_FAIL_TTL_SECONDS);
      }
      await this.logLogin({
        userId: null,
        email: identifier,
        ip,
        userAgent,
        success: false,
        failReason: record ? '密码错误' : '用户不存在',
      });
      if (failures >= LOGIN_FAIL_LIMIT) {
        throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
      }
      // 统一文案，不区分用户不存在与密码错误
      throw new UnauthorizedException('账号或密码错误');
    }

    await this.redis.del(failKey);
    if (record.status === UserStatus.BANNED) {
      await this.logLogin({
        userId: null,
        email: identifier,
        ip,
        userAgent,
        success: false,
        failReason: '账号已封禁',
      });
      throw new ForbiddenException('账号已被封禁');
    }
    await this.logLogin({
      userId: record.id,
      email: identifier,
      ip,
      userAgent,
      success: true,
    });
    const user = await this.usersService.getSelf(record.id);
    const tokens = await this.issueTokens(record.id);
    return { user, tokens };
  }

  async refresh(refreshToken: string | undefined): Promise<{ user: UserPublic; tokens: AuthTokens }> {
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
    if (!payload || typeof payload.sub !== 'string' || typeof payload.jti !== 'string' || !Number.isInteger(payload.sessionVersion)) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const authUser = await this.usersService.getAuthUser(payload.sub);
    if (!authUser) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (authUser.status === UserStatus.BANNED) {
      throw new ForbiddenException('账号已被封禁');
    }
    if (authUser.sessionVersion !== payload.sessionVersion) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }
    const newJti = uuidv7();
    const tokens = this.signTokens(authUser, newJti);
    const rotated = await this.refreshStore.rotate(authUser.id, payload.jti, newJti, REFRESH_TOKEN_TTL_SECONDS);
    if (!rotated) {
      // 复用使全部旧 access/refresh 失效；新 jti 已在同一个原子操作中登记，不会漏吊销。
      await this.usersService.invalidateSessions(authUser.id, authUser.sessionVersion);
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }
    const user = await this.usersService.getPublic(authUser.id);
    return { user, tokens };
  }

  async logout(
    refreshToken: string | undefined,
    ip = '',
    userAgent?: string | null,
  ): Promise<void> {
    if (!refreshToken) {
      return;
    }
    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: this.cfg.jwtRefreshSecret,
      });
    } catch {
      // 无效 refresh token 视为已登出
      return;
    }
    if (payload && typeof payload.sub === 'string') {
      const user = await this.usersService.getAuthRecordById(payload.sub);
      // 已失效的旧凭据不能用来反复踢掉用户新登录的会话。
      if (user && user.sessionVersion === payload.sessionVersion) {
        await this.usersService.invalidateSessions(payload.sub, user.sessionVersion);
        await this.logLogin({
          userId: user.id,
          email: user.email ?? user.phone ?? '',
          ip,
          userAgent,
          success: true,
        });
      }
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    await this.captchaService.validate(dto.captchaId, dto.captchaCode);
    const record = await this.usersService.getAuthRecordById(userId);
    if (!record) {
      throw new NotFoundException('用户不存在');
    }
    const ok = await verifyPassword(record.passwordHash, dto.currentPassword);
    if (!ok) {
      throw new BadRequestException('当前密码错误');
    }
    // v12.0：修改密码需当前绑定邮箱的邮件验证码（purpose=password）
    const self = await this.usersService.getSelf(userId);
    if (!self.email) {
      throw new BadRequestException('该账号未绑定邮箱，请先绑定邮箱后再修改密码');
    }
    await this.emailCodeService.check(self.email, 'password', dto.emailCode);
    const passwordHash = await hashPassword(dto.newPassword);
    // 写入前原子消费邮件码；此前的失败（如密码错误）不消耗验证码
    await this.emailCodeService.validate(self.email, 'password', dto.emailCode);
    await this.usersService.updatePasswordHash(userId, passwordHash);
    await this.refreshStore.revokeAll(userId);
  }

  /** 拉取邮件验证码（v12.0）：图形验证码前置 + 收件地址限频在 EmailCodeService 内 */
  async sendEmailCode(dto: EmailCodeDto): Promise<void> {
    await this.captchaService.validate(dto.captchaId, dto.captchaCode);
    await this.emailCodeService.issue(normalizeIdentifier(dto.email), dto.purpose);
  }

  /** 忘记密码（v12.0）：无论账号是否存在均无返回差异（防账号枚举） */
  async requestPasswordReset(dto: ForgotPasswordDto): Promise<void> {
    await this.captchaService.validate(dto.captchaId, dto.captchaCode);
    const email = normalizeIdentifier(dto.identifier);
    const record = await this.usersService.findByIdentifier(email);
    if (!record || record.status === UserStatus.BANNED) {
      return;
    }
    const token = await this.resetTokens.issue(record.id);
    await this.mailService.send(email, 'reset-password', {
      resetPath: `reset-password?token=${token}`,
      expiresMinutes: '30',
    });
  }

  /** 重置密码（v12.0）：一次性链接 token，成功后全会话失效（同改密口径） */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.resetTokens.consume(dto.token);
    if (!userId) {
      throw new BadRequestException('链接无效或已过期');
    }
    const record = await this.usersService.getAuthRecordById(userId);
    if (!record || record.status === UserStatus.BANNED) {
      throw new BadRequestException('链接无效或已过期');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.usersService.updatePasswordHash(userId, passwordHash);
    await this.refreshStore.revokeAll(userId);
  }

  /** 一键退订通知邮件（v12.0）：token 化链接，无需登录 */
  async unsubscribe(dto: UnsubscribeDto): Promise<void> {
    const userId = verifyUnsubscribeToken(this.crypto, dto.token);
    if (!userId) {
      throw new BadRequestException('链接无效或已过期');
    }
    try {
      await this.usersService.updateNoticePref(userId, false);
    } catch (error) {
      // 账号已删除（如被剔除学员）归一为 400，与重置密码的防枚举口径一致，不暴露账号状态
      if (error instanceof NotFoundException) {
        throw new BadRequestException('链接无效或已过期');
      }
      throw error;
    }
  }

  async getMe(userId: string): Promise<UserSelf> {
    return this.usersService.getSelf(userId);
  }
}
