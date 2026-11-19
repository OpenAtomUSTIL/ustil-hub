import { Database, type DatabaseTransaction } from '../../db';
import { Inject, Injectable, Logger, BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { verify } from 'argon2';
import { isEmail, isMobilePhone } from 'class-validator';
import { Role } from '../../common/decorators/roles.decorator';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Page } from '../../common/dto/page';
import { CryptoService } from '../../common/crypto/crypto.service';
import { isUuid, USERNAME_RE, uniqueUsername } from '../../common/utils/identifiers';
import { requireRole } from '../../common/permissions';
import { REFRESH_TOKEN_STORE, RefreshTokenStore } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { CaptchaService } from '../captcha/captcha.service';
import { EmailCodeService } from '../mail/email-code.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService, UploadedFileInput } from '../storage/uploads.service';
import { ChangeIdentifierDto } from './dto/change-identifier.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ActivityParts, PinnedTarget, UsersRepository, UserRow } from './users.repository';
import {
  AdminUserPage,
  AdminUserView,
  AuthUser,
  AvatarFileRef,
  FollowUserView,
  UserAuthRecord,
  UserPublic,
  UserSelf,
  UserProfileView,
  ActivityView,
  ProfileReplyView,
  UserStatsBadgeView,
} from './users.views';

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
}

export function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly crypto: CryptoService,
    private readonly uploadsService: UploadsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly captchaService: CaptchaService,
    private readonly emailCodeService: EmailCodeService,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshStore: RefreshTokenStore,
  ) {}

  /** 解密行内信封字段（v10.0）：行缺 cryptoId（回填前）或 token 校验失败一律返回 null，视图优雅降级 */
  private openField(purpose: string, token: string | null | undefined, row: UserRow): string | null {
    return this.crypto.open(purpose, token, row.cryptoId ?? '');
  }

  private toSelf(row: UserRow): UserSelf {
    const self: UserSelf = {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    if (row.email) {
      const email = this.openField('email', row.email, row);
      if (email) self.email = email;
    }
    if (row.phone) {
      const phone = this.openField('phone', row.phone, row);
      if (phone) self.phone = phone;
    }
    return self;
  }

  private toPublic(row: UserRow): UserPublic {
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
    };
  }

  adminFileSource(connection: Pick<Database, 'select'>, keyword?: string) {
    return this.usersRepository.adminFileSource(connection, keyword);
  }

  private async ensureIdentifierAvailable(
    email: string | null,
    phone: string | null,
    connection: DatabaseTransaction,
    excludeId?: string,
  ): Promise<void> {
    const emailHmac = email ? this.crypto.hmac(email) : null;
    const phoneHmac = phone ? this.crypto.hmac(phone) : null;
    if (!emailHmac && !phoneHmac) return;
    // 冲突文案随校验的标识类型收敛（v12.0 注册仅邮箱）
    const conflictMessage = email && phone
      ? '该邮箱或手机号已被占用'
      : email
        ? '该邮箱已被注册'
        : '该手机号已被占用';
    const candidates = await this.usersRepository.findIdentifierCandidates(emailHmac, phoneHmac, connection);
    for (const row of candidates) {
      if (row.id === excludeId) continue;
      for (const type of ['email', 'phone'] as const) {
        const value = type === 'email' ? email : phone;
        const hash = type === 'email' ? emailHmac : phoneHmac;
        if (!value || !row[type]) continue;
        const storedHash = type === 'email' ? row.emailHmac : row.phoneHmac;
        if (storedHash) {
          if (storedHash === hash) throw new ConflictException(conflictMessage);
          continue;
        }
        // 旧明文与缺失 HMAC 的有效信封均要检查，不能仅依赖可空唯一索引。
        const stored = this.crypto.open(type, row[type], row.cryptoId ?? '')
          ?? ((type === 'email' ? isEmail(row[type]!.trim()) : isMobilePhone(row[type]!.trim(), 'zh-CN')) ? row[type] : null);
        if (!stored) throw new ServiceUnavailableException('账号资料校验暂不可用，请稍后重试');
        if (normalizeIdentifier(stored) === value) throw new ConflictException(conflictMessage);
      }
    }
  }

  async createUser(input: {
    email?: string | null;
    phone?: string | null;
    passwordHash: string;
    nickname: string;
    role?: Role;
    inviteCodeId?: string | null;
    emailVerifiedAt?: Date | null;
  }): Promise<UserSelf> {
    try {
      return await this.usersRepository.withUsernameLock(async (tx) => {
        const email = input.email ? normalizeIdentifier(input.email) : null;
        const phone = input.phone ? normalizeIdentifier(input.phone) : null;
        await this.ensureIdentifierAvailable(email, phone, tx);
        const username = await uniqueUsername(input.nickname, (u) =>
          this.usersRepository.usernameExists(u, tx),
        );
        // 信封加密（v10.0）：每用户 cryptoId 参与密钥派生；标识列存 token，唯一性/精确查走 HMAC 列
        const cryptoId = this.crypto.newCryptoId();
        const row = await this.usersRepository.insert({
          email: this.crypto.seal('email', email, cryptoId),
          phone: this.crypto.seal('phone', phone, cryptoId),
          cryptoId,
          emailHmac: email ? this.crypto.hmac(email) : null,
          phoneHmac: phone ? this.crypto.hmac(phone) : null,
          passwordHash: input.passwordHash,
          nickname: input.nickname,
          username,
          ...(input.role ? { role: input.role } : {}),
          inviteCodeId: input.inviteCodeId ?? null,
          emailVerifiedAt: input.emailVerifiedAt ?? null,
        }, tx);
        return this.toSelf(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('该邮箱已被注册');
      }
      throw error;
    }
  }

  /** 登录精确查（v10.0）：identifier 归一化（邮箱小写、手机号原样）后按 HMAC 查找列定位 */
  async findByIdentifier(identifier: string): Promise<UserAuthRecord | null> {
    const hmac = this.crypto.hmac(normalizeIdentifier(identifier));
    const row = await this.usersRepository.findByEmailHmacOrPhoneHmac(hmac, hmac);
    return row ? this.toAuthRecord(row) : null;
  }

  /**
   * 解析式寻址（v6.0→v10.0）：uuid → username（含历史 handle）→ email → phone，顺序即优先级。
   * email 形状与 username 不撞形（USERNAME_RE 不含 @）可直达；纯数字可能与 username 撞形，username 优先。
   * email/phone 精确查走 HMAC 查找列（hmac 前邮箱小写、手机号原样）；未命中 null，语义由调用方决定。
   */
  async resolveRowByIdentifier(identifier: string): Promise<UserRow | null> {
    const trimmed = identifier.trim();
    if (!trimmed) return null;
    if (isUuid(trimmed)) return this.usersRepository.findById(trimmed);
    if (isEmail(trimmed)) return this.usersRepository.findByEmailHmac(this.crypto.hmac(normalizeIdentifier(trimmed)));
    const byUsername = await this.usersRepository.findByUsername(trimmed);
    if (byUsername) return byUsername;
    if (isMobilePhone(trimmed, 'zh-CN')) return this.usersRepository.findByPhoneHmac(this.crypto.hmac(trimmed));
    return null;
  }

  async getAuthRecordById(id: string): Promise<UserAuthRecord | null> {
    const row = await this.usersRepository.findById(id);
    return row ? this.toAuthRecord(row) : null;
  }

  private toAuthRecord(row: UserRow): UserAuthRecord {
    return {
      id: row.id,
      email: this.openField('email', row.email, row),
      phone: this.openField('phone', row.phone, row),
      passwordHash: row.passwordHash,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
      status: row.status,
      sessionVersion: row.sessionVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getSelf(id: string): Promise<UserSelf> {
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    return this.toSelf(row);
  }

  async getAuthUser(id: string): Promise<AuthUser | null> {
    const row = await this.usersRepository.findById(id);
    return row
      ? {
          id: row.id,
          role: row.role as Role,
          status: row.status,
          sessionVersion: row.sessionVersion,
          email: this.openField('email', row.email, row),
        }
      : null;
  }

  async getPublic(idOrUsername: string): Promise<UserPublic> {
    const row = await this.usersRepository.findByIdOrUsername(idOrUsername);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    return this.toPublic(row);
  }

  async getPublicByIds(ids: string[]): Promise<Map<string, UserPublic>> {
    const rows = await this.usersRepository.findByIds(ids);
    return new Map(rows.map((row) => [row.id, this.toPublic(row)]));
  }

  async updateProfile(id: string, patch: UpdateProfileDto): Promise<UserSelf> {
    if (patch.nickname === undefined && patch.avatarUrl === undefined) {
      return this.getSelf(id);
    }
    const row = await this.usersRepository.updateProfile(id, patch);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    return this.toSelf(row);
  }

  async changeIdentifier(id: string, dto: ChangeIdentifierDto): Promise<UserSelf> {
    await this.captchaService.validate(dto.captchaId, dto.captchaCode);
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role === Role.ADMIN) {
      throw new ForbiddenException('管理员账号初始化后不可修改');
    }
    const ok = await verify(row.passwordHash, dto.password);
    if (!ok) {
      throw new BadRequestException('当前密码错误');
    }
    const value = normalizeIdentifier(dto.value);
    if (dto.type === 'email') {
      if (!isEmail(value)) {
        throw new BadRequestException('邮箱格式错误');
      }
      // v12.0：换绑邮箱必须先通过新邮箱的邮件验证码（purpose=rebind，一次性消费）
    } else if (!isMobilePhone(value, 'zh-CN')) {
      throw new BadRequestException('手机号格式错误');
    }
    const hmac = this.crypto.hmac(value);
    let updated: UserRow | null;
    try {
      // 注册与换绑共用同一事务锁，避免旧账号缺少 HMAC 时被并发占用。
      updated = await this.usersRepository.withUsernameLock(async (tx) => {
        await this.ensureIdentifierAvailable(dto.type === 'email' ? value : null, dto.type === 'phone' ? value : null, tx, id);
        return this.usersRepository.withUserLock(id, async (current, lockedTx) => {
          if (!current) throw new NotFoundException('用户不存在');
          if (current.role === Role.ADMIN) throw new ForbiddenException('管理员账号初始化后不可修改');
          if (current.passwordHash !== row.passwordHash) throw new BadRequestException('密码已变更，请重试');
          if (dto.type === 'email') await this.emailCodeService.validate(value, 'rebind', dto.emailCode ?? '');
          const cryptoId = current.cryptoId ?? this.crypto.newCryptoId();
          // v12.0：手机号为可选附加绑定——只更新当前类型字段，不再清空另一标识
          return this.usersRepository.updateIdentifier(id, {
            ...(dto.type === 'email'
              ? {
                  email: this.crypto.seal('email', value, cryptoId),
                  emailHmac: hmac,
                  emailVerifiedAt: new Date(),
                }
              : {
                  phone: this.crypto.seal('phone', value, cryptoId),
                  phoneHmac: hmac,
                }),
            ...(current.cryptoId ? {} : { cryptoId }),
          }, lockedTx);
        }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(dto.type === 'email' ? '该邮箱已被注册' : '该手机号已被占用');
      }
      throw error;
    }
    if (!updated) {
      throw new NotFoundException('用户不存在');
    }
    return this.toSelf(updated);
  }

  async uploadAvatar(id: string, file: UploadedFileInput): Promise<UserSelf> {
    const avatarUrl = await this.uploadsService.storeAvatar(file);
    return this.updateProfile(id, { avatarUrl });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.usersRepository.updatePasswordHash(id, passwordHash);
  }

  /** 通知邮件偏好（v12.0）：总开关，默认关 */
  async getNoticePref(id: string): Promise<{ emailNoticeEnabled: boolean }> {
    const row = await this.usersRepository.findById(id);
    return { emailNoticeEnabled: row?.emailNoticeEnabled ?? false };
  }

  async updateNoticePref(id: string, enabled: boolean): Promise<{ emailNoticeEnabled: boolean }> {
    const row = await this.usersRepository.updateNoticePref(id, enabled);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    return { emailNoticeEnabled: row.emailNoticeEnabled };
  }

  /** 通知邮件收件人解析（v12.0）：仅 ACTIVE + 已验证邮箱 + 邮件提醒开启；邮箱在此解密，不出 users 模块 */
  async getMailRecipients(
    userIds: string[],
  ): Promise<{ userId: string; email: string; nickname: string }[]> {
    if (userIds.length === 0) {
      return [];
    }
    const rows = await this.usersRepository.findByIds(userIds);
    const result: { userId: string; email: string; nickname: string }[] = [];
    for (const row of rows) {
      if (row.status !== UserStatus.ACTIVE || !row.emailNoticeEnabled || !row.email || !row.emailVerifiedAt) {
        continue;
      }
      const email = this.openField('email', row.email, row);
      if (email) {
        result.push({ userId: row.id, email, nickname: row.nickname });
      }
    }
    return result;
  }

  async invalidateSessions(id: string, expectedVersion?: number): Promise<void> {
    if (await this.usersRepository.invalidateSessions(id, expectedVersion)) {
      await this.refreshStore.revokeAll(id);
    }
  }

  private async requireNonAdmin(identifier: string): Promise<UserRow> {
    const row = await this.resolveRowByIdentifier(identifier);
    if (!row) throw new NotFoundException('用户不存在');
    if (row.role === Role.ADMIN) throw new ForbiddenException('不可修改管理员账号');
    return row;
  }

  async ban(identifier: string, actor: CurrentAuthUser): Promise<{ id: string; status: UserStatus }> {
    requireRole(actor, Role.ADMIN);
    const target = await this.requireNonAdmin(identifier);
    const row = await this.usersRepository.updateStatus(target.id, UserStatus.BANNED);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    // 封禁立即吊销全部 refresh token
    await this.refreshStore.revokeAll(target.id);
    await this.auditLogService.record({
      actor,
      action: 'user.ban',
      targetType: 'USER',
      targetId: target.id,
      detail: { from: 'ACTIVE', to: 'BANNED' },
    });
    return { id: row.id, status: row.status };
  }

  async unban(identifier: string, actor: CurrentAuthUser): Promise<{ id: string; status: UserStatus }> {
    requireRole(actor, Role.ADMIN);
    const target = await this.requireNonAdmin(identifier);
    const row = await this.usersRepository.updateStatus(target.id, UserStatus.ACTIVE);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    await this.auditLogService.record({
      actor,
      action: 'user.unban',
      targetType: 'USER',
      targetId: target.id,
      detail: { from: 'BANNED', to: 'ACTIVE' },
    });
    return { id: row.id, status: row.status };
  }

  // ===== 管理后台 =====

  private toAdminView(row: UserRow): AdminUserView {
    // 掩码用解密后明文再打码（v10.0），密文不进视图
    let contact: string | null = null;
    const email = this.openField('email', row.email, row);
    const phone = this.openField('phone', row.phone, row);
    if (email) {
      const [local, domain] = email.split('@');
      contact = `${local.slice(0, 1)}***@${domain}`;
    } else if (phone) {
      contact =
        phone.length >= 7
          ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
          : '***';
    }
    return {
      id: row.id,
      nickname: row.nickname,
      contact,
      role: row.role as Role,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listForAdmin(query: {
    keyword?: string;
    role?: Role;
    status?: UserStatus;
    page: number;
    pageSize: number;
  }, actor: CurrentAuthUser): Promise<AdminUserPage> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const { rows, total } = await this.usersRepository.listForAdmin(query);
    return {
      items: rows.map((row) => this.toAdminView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async updateRole(identifier: string, role: Exclude<Role, 'ADMIN'>, actor: CurrentAuthUser): Promise<AdminUserView> {
    requireRole(actor, Role.ADMIN);
    if (![Role.VISITOR, Role.MEMBER, Role.ALUMNI, Role.WHEEL].includes(role)) {
      throw new BadRequestException('不允许授予该角色');
    }
    const row = await this.resolveRowByIdentifier(identifier);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role === Role.ADMIN) {
      throw new ForbiddenException('不可修改管理员账号');
    }
    const updated = await this.usersRepository.updateRole(row.id, role, row.role);
    if (!updated) {
      throw new ConflictException('用户角色已变化，请刷新后重试');
    }
    // 角色变更后强制重登（旧 token 内含旧角色）
    await this.refreshStore.revokeAll(row.id);
    await this.notificationsService.notifyUser(row.id, {
      type: 'ROLE',
      title: '角色变更',
      body: `你的角色已从 ${row.role} 变更为 ${role}`,
    });
    await this.auditLogService.record({
      actor,
      action: 'user.role.change',
      targetType: 'USER',
      targetId: row.id,
      detail: { from: row.role, to: role },
    });
    return this.toAdminView(updated);
  }

  async promoteToAlumni(identifier: string, actor: CurrentAuthUser): Promise<AdminUserView> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const row = await this.resolveRowByIdentifier(identifier);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role !== Role.MEMBER) {
      throw new ForbiddenException('仅学习成员可提前提拔');
    }
    const updated = await this.usersRepository.updateRole(row.id, Role.ALUMNI, Role.MEMBER);
    if (!updated) {
      throw new ConflictException('用户角色已变化，请刷新后重试');
    }
    await this.refreshStore.revokeAll(row.id);
    await this.notificationsService.notifyUser(row.id, {
      type: 'ROLE',
      title: '角色变更',
      body: '你的角色已从 MEMBER 变更为 ALUMNI',
    });
    await this.auditLogService.record({
      actor,
      action: 'user.promote',
      targetType: 'USER',
      targetId: row.id,
      detail: { from: 'MEMBER', to: 'ALUMNI' },
    });
    return this.toAdminView(updated);
  }

  async removeByAdmin(identifier: string, actor: CurrentAuthUser): Promise<void> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const row = await this.resolveRowByIdentifier(identifier);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role !== Role.MEMBER && row.role !== Role.VISITOR) {
      throw new ForbiddenException('仅可剔除学习成员或临时访客');
    }
    await this.refreshStore.revokeAll(row.id);
    // taggings/名下内容清理已并入 deleteById 单事务 purge（v8.0 修复 RESTRICT 500）
    const deleted = await this.usersRepository.deleteById(row.id, actor.id);
    if (!deleted) throw new ConflictException('用户角色已变化，请刷新后重试');
    void this.uploadsService.flushPendingFileDeletions(25).catch(() => {
      this.logger.warn('File cleanup will retry in scheduled task');
    });
    await this.auditLogService.record({
      actor,
      action: 'user.remove',
      targetType: 'USER',
      targetId: row.id,
      detail: { role: row.role },
    });
  }

  async countByRole(): Promise<Record<string, number>> {
    return this.usersRepository.countByRole();
  }

  // ===== 管理后台：头像文件引用（文件管理合成 kind=AVATAR 条目用） =====

  private avatarKeyOf(avatarUrl: string | null): string | null {
    const match = avatarUrl?.match(/^\/api\/v1\/storage\/files\/(.+)$/);
    return match ? match[1] : null;
  }

  async listAvatarFilesForAdmin(params: {
    keyword?: string;
    limit: number;
  }): Promise<{ rows: AvatarFileRef[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.usersRepository.listAvatarFiles(params),
      this.usersRepository.countAvatarFiles(params.keyword),
    ]);
    return {
      rows: rows
        .map((row) => ({
          userId: row.id,
          email: this.openField('email', row.email, row),
          nickname: row.nickname,
          key: this.avatarKeyOf(row.avatarUrl) ?? '',
          updatedAt: row.updatedAt,
        }))
        .filter((ref) => ref.key.length > 0),
      total,
    };
  }

  /** 清空头像引用并返回存储 key；用户不存在或头像非受控存储文件时返回 null */
  async deleteAvatarFileForAdmin(userId: string): Promise<{ key: string } | null> {
    const row = await this.usersRepository.findById(userId);
    if (!row) {
      return null;
    }
    const key = this.avatarKeyOf(row.avatarUrl);
    if (!key) {
      return null;
    }
    if (!row.avatarUrl) return null;
    const cleared = await this.usersRepository.clearAvatar(userId, row.avatarUrl);
    if (!cleared) throw new ConflictException('头像已变更，请刷新后重试');
    return { key };
  }

  /** 只读取头像存储 key；用户不存在或头像非受控存储文件时返回 null */
  async getAvatarFileForAdmin(userId: string): Promise<{ key: string } | null> {
    const row = await this.usersRepository.findById(userId);
    if (!row) {
      return null;
    }
    const key = this.avatarKeyOf(row.avatarUrl);
    return key ? { key } : null;
  }

  /** 哪些存储 key 正被用户头像引用 */
  async findAvatarReferencedKeys(keys: string[]): Promise<Set<string>> {
    return this.usersRepository.findAvatarReferencedKeys(keys);
  }

  /** 管理端上传者邮箱展示（v10.0：解密后明文出视图） */
  async getEmailsByIds(ids: string[]): Promise<Map<string, string | null>> {
    const rows = await this.usersRepository.findEmailsByIds(ids);
    return new Map(
      [...rows].map(([id, value]) => [
        id,
        this.crypto.open('email', value.email, value.cryptoId ?? ''),
      ]),
    );
  }

  /** 按昵称模糊搜用户 id（管理端评论按作者搜索用；v10.0 邮箱加密后退出模糊搜） */
  async searchIdsByKeyword(keyword: string): Promise<string[]> {
    return this.usersRepository.searchIdsByKeyword(keyword);
  }

  /** 全部 ACTIVE 用户 id（公告 notify 用） */
  async listActiveUserIds(): Promise<string[]> {
    return this.usersRepository.listActiveUserIds();
  }

  /** 指定角色全体用户 id（发布作业通知用） */
  async listUserIdsByRoles(roles: Role[]): Promise<string[]> {
    return this.usersRepository.listIdsByRoles(roles as UserRow['role'][]);
  }

  async countVisitorsCreatedBefore(before: Date): Promise<number> {
    return this.usersRepository.countVisitorsCreatedBefore(before);
  }

  /** 持码转正：仅 VISITOR 可用，转为 MEMBER 并记录来源邀请码 */
  async applyInviteCode(id: string, inviteCodeId: string): Promise<UserSelf> {
    const row = await this.usersRepository.applyInviteCode(id, inviteCodeId);
    if (!row) {
      throw new ForbiddenException('仅临时访客可使用邀请码转正');
    }
    return this.toSelf(row);
  }

  /** 定时任务：删除创建满 7 天的 VISITOR（级联其讨论/提交），并吊销其 refresh */
  async cleanupExpiredVisitors(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const ids = await this.usersRepository.listExpiredVisitorIds(cutoff);
    let deleted = 0;
    for (const id of ids) {
      try {
        const removed = await this.usersRepository.deleteById(id, undefined, cutoff);
        if (!removed) continue;
        deleted++;
        await this.refreshStore.revokeAll(id);
      } catch {
        // 单个异常不阻断其余访客清理；失败事务已回滚，下次仍可重试。
        this.logger.warn('Expired visitor cleanup deferred');
      }
    }
    await this.uploadsService.flushPendingFileDeletions().catch(() => {
      this.logger.warn('File cleanup will retry in scheduled task');
    });
    return deleted;
  }

  /** 定时任务：MEMBER 注册满 4 年自动升 ALUMNI */
  async promoteExpiredMembers(): Promise<number> {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 4);
    return this.usersRepository.promoteMembersCreatedBefore(cutoff);
  }

  // ===== 个人主页 =====

  /** id 或 username 定位用户（URL 不暴露裸 id，旧 id 链接兼容） */
  private async resolveUser(idOrUsername: string): Promise<UserRow> {
    const row = await this.usersRepository.findByIdOrUsername(idOrUsername);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    return row;
  }

  async getProfile(idOrUsername: string, viewer: CurrentAuthUser): Promise<UserProfileView> {
    const row = await this.resolveUser(idOrUsername);
    const isSelf = viewer.id === row.id;
    if (viewer.role === Role.VISITOR && !isSelf) {
      throw new ForbiddenException('无权访问该资源');
    }

    const [stats, topTags, targets, followCounts, isFollowing] = await Promise.all([
      this.usersRepository.getProfileStats(row.id),
      this.usersRepository.getProfileTopTags(row.id, 10),
      this.usersRepository.findPinnedTargets(row.pinnedItems ?? []),
      this.usersRepository.getFollowCounts(row.id),
      isSelf ? Promise.resolve(false) : this.usersRepository.isFollowing(viewer.id, row.id),
    ]);

    const targetByKey = new Map(targets.map((t) => [`${t.type}:${t.id}`, t]));
    const pinnedItems = (row.pinnedItems ?? [])
      .map((item) => targetByKey.get(`${item.type}:${item.id}`))
      .filter((t): t is PinnedTarget => Boolean(t))
      .map((t) => ({ type: t.type, id: t.id, slug: t.slug, title: t.title, url: t.url }));

    const profile: UserProfileView = {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
      bio: this.openField('profile', row.bio, row),
      profileReadme: this.openField('profile', row.profileReadme, row),
      company: this.openField('profile', row.company, row),
      location: this.openField('profile', row.location, row),
      link: this.openField('profile', row.link, row),
      socials: (row.socials ?? [])
        .map((item) => this.openField('social', item, row))
        .filter((item): item is string => item !== null),
      createdAt: row.createdAt.toISOString(),
      stats,
      topTags,
      pinnedItems,
      isSelf,
      isFollowing,
      followerCount: followCounts.followers,
      followingCount: followCounts.following,
    };
    if (isSelf) {
      const email = this.openField('email', row.email, row);
      if (email) profile.email = email;
      const phone = this.openField('phone', row.phone, row);
      if (phone) profile.phone = phone;
    }
    return profile;
  }

  async updateProfilePage(
    userId: string,
    dto: {
      bio?: string | null;
      profileReadme?: string | null;
      pinnedItems?: { type: string; id: string }[];
      company?: string | null;
      location?: string | null;
      link?: string | null;
      socials?: string[] | null;
    },
  ): Promise<void> {
    if (dto.bio !== undefined && dto.bio !== null && dto.bio.length > 100) {
      throw new BadRequestException('bio 不能超过 100 个字符');
    }
    if (dto.profileReadme !== undefined && dto.profileReadme !== null && dto.profileReadme.length > 10000) {
      throw new BadRequestException('个人介绍不能超过 10000 个字符');
    }
    // GitHub 式资料字段（v9.0）：长度校验镜像 DTO，社交账户规范化（剔空、截 4）
    for (const [key, value, max] of [
      ['公司/学校', dto.company, 100],
      ['所在地', dto.location, 100],
      ['个人链接', dto.link, 200],
    ] as const) {
      if (value !== undefined && value !== null && value.length > max) {
        throw new BadRequestException(`${key}不能超过 ${max} 个字符`);
      }
    }
    if (dto.socials !== undefined && dto.socials !== null) {
      if (dto.socials.length > 4) {
        throw new BadRequestException('社交账户最多 4 条');
      }
      for (const item of dto.socials) {
        if (item.length > 200) {
          throw new BadRequestException('社交账户链接不能超过 200 个字符');
        }
      }
    }
    if (dto.pinnedItems !== undefined) {
      if (dto.pinnedItems.length > 6) {
        throw new BadRequestException('置顶内容不能超过 6 项');
      }
      const keys = new Set(dto.pinnedItems.map((i) => `${i.type}:${i.id}`));
      if (keys.size !== dto.pinnedItems.length) {
        throw new BadRequestException('置顶内容不能重复');
      }
      const targets = await this.usersRepository.findPinnedTargets(dto.pinnedItems);
      const targetByKey = new Map(targets.map((t) => [`${t.type}:${t.id}`, t]));
      for (const item of dto.pinnedItems) {
        const target = targetByKey.get(`${item.type}:${item.id}`);
        if (!target || target.ownerId !== userId) {
          throw new BadRequestException('置顶内容不存在或不属于本人');
        }
      }
    }
    // 信封加密（v10.0）：资料字段共用 'profile' 用途域，socials 逐条 'social'（空串 seal 为 null 条目，读取侧过滤）
    await this.usersRepository.withUserLock(userId, async (row, tx) => {
      if (!row) {
        throw new NotFoundException('用户不存在');
      }
      const cryptoId = row.cryptoId ?? this.crypto.newCryptoId();
      const sealProfile = (value: string | null | undefined): string | null | undefined =>
        value === undefined ? undefined : this.crypto.seal('profile', value, cryptoId);
      const updated = await this.usersRepository.updateProfilePage(userId, {
        bio: sealProfile(dto.bio),
        profileReadme: sealProfile(dto.profileReadme),
        pinnedItems: dto.pinnedItems,
        company: sealProfile(dto.company),
        location: sealProfile(dto.location),
        link: sealProfile(dto.link),
        socials:
          dto.socials === undefined
            ? undefined
            : dto.socials === null
              ? null
              : dto.socials.map((item) => this.crypto.seal('social', item, cryptoId)),
        ...(row.cryptoId ? {} : { cryptoId }),
      }, tx);
      if (!updated) {
        throw new NotFoundException('用户不存在');
      }
    });
  }

  async getActivity(idOrUsername: string, viewer: CurrentAuthUser): Promise<ActivityView> {
    const row = await this.resolveUser(idOrUsername);
    const isSelf = viewer.id === row.id;
    if (viewer.role === Role.VISITOR && !isSelf) {
      throw new ForbiddenException('无权访问该资源');
    }
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    const parts = await this.usersRepository.getActivityParts(row.id, since);
    return { days: mergeActivityParts(parts) };
  }

  /** 个人主页 · 社区数据徽章（公开聚合口径，软删不计，与 getActivity 一致；按用户名 handle 寻址） */
  async getStatsBadges(username: string): Promise<UserStatsBadgeView> {
    const row = await this.usersRepository.findByUsername(username);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    const [stats, parts] = await Promise.all([
      this.usersRepository.getProfileStats(row.id),
      this.usersRepository.getActivityParts(row.id, since),
    ]);
    const days = mergeActivityParts(parts);
    return {
      ...stats,
      contributions: days.reduce((sum, d) => sum + d.count, 0),
      streak: computeStreak(days),
    };
  }

  /** 个人主页 · 回复 Tab：本人或 MEMBER+ 互访可见，VISITOR 仅看自己 */
  async getReplies(
    idOrUsername: string,
    viewer: CurrentAuthUser,
    page: number,
    pageSize: number,
  ): Promise<Page<ProfileReplyView>> {
    const row = await this.resolveUser(idOrUsername);
    const isSelf = viewer.id === row.id;
    if (viewer.role === Role.VISITOR && !isSelf) {
      throw new ForbiddenException('无权访问该资源');
    }
    const { rows, total } = await this.usersRepository.listRepliesByAuthor(row.id, page, pageSize);
    return {
      items: rows.map((r) => ({
        id: r.id,
        issueId: r.issueId,
        issueSlug: r.issueSlug,
        issueTitle: r.issueTitle,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ===== 用户名（handle） =====

  async updateUsername(userId: string, dto: { username: string }): Promise<UserSelf> {
    const username = dto.username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      throw new BadRequestException('用户名需为 2-32 位字母、数字、- 或 _');
    }
    return this.usersRepository.withUsernameLock(async (tx) => {
      const current = await this.usersRepository.findById(userId, tx);
      if (!current) {
        throw new NotFoundException('用户不存在');
      }
      if (current.username === username) {
        return this.toSelf(current);
      }
      if (await this.usersRepository.usernameExists(username, tx)) {
        throw new ConflictException('该用户名已被占用');
      }
      let updated: UserRow | null;
      try {
        updated = await this.usersRepository.updateUsername(userId, username, current.username, tx);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException('该用户名已被占用');
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('用户不存在');
      }
      return this.toSelf(updated);
    });
  }

  // ===== 关注 =====

  async follow(idOrUsername: string, viewer: CurrentAuthUser): Promise<{ following: boolean }> {
    const row = await this.resolveUser(idOrUsername);
    if (row.id === viewer.id) {
      throw new BadRequestException('不能关注自己');
    }
    if (viewer.role === Role.VISITOR) {
      throw new ForbiddenException('无权访问该资源');
    }
    if (row.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('用户不存在');
    }
    const created = await this.usersRepository.insertFollow(viewer.id, row.id);
    if (created) {
      const actorRow = await this.usersRepository.findById(viewer.id);
      await this.notificationsService.notifyUser(row.id, {
        type: 'FOLLOW',
        title: '新的关注者',
        body: `${actorRow?.nickname ?? '有人'} 关注了你`,
        link: `/users/${actorRow?.username ?? viewer.id}`,
      });
    }
    return { following: true };
  }

  async unfollow(idOrUsername: string, viewer: CurrentAuthUser): Promise<{ following: boolean }> {
    const row = await this.resolveUser(idOrUsername);
    await this.usersRepository.deleteFollow(viewer.id, row.id);
    return { following: false };
  }

  private toFollowUserView(row: UserRow, viewerId: string, followed: boolean): FollowUserView {
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
      bio: this.openField('profile', row.bio, row),
      isSelf: viewerId === row.id,
      isFollowing: followed,
    };
  }

  private async toFollowUserPage(
    rows: UserRow[],
    viewer: CurrentAuthUser,
    total: number,
    page: number,
    pageSize: number,
  ): Promise<Page<FollowUserView>> {
    const followedIds = await this.usersRepository.filterFollowedIds(
      viewer.id,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => this.toFollowUserView(r, viewer.id, followedIds.has(r.id))),
      total,
      page,
      pageSize,
    };
  }

  /** 粉丝列表：本人或 MEMBER+ 互访可见，VISITOR 仅看自己；排除封禁 */
  async listFollowers(
    idOrUsername: string,
    viewer: CurrentAuthUser,
    page: number,
    pageSize: number,
  ): Promise<Page<FollowUserView>> {
    const row = await this.resolveUser(idOrUsername);
    if (viewer.role === Role.VISITOR && viewer.id !== row.id) {
      throw new ForbiddenException('无权访问该资源');
    }
    const { rows, total } = await this.usersRepository.listFollowers(row.id, page, pageSize);
    return this.toFollowUserPage(rows, viewer, total, page, pageSize);
  }

  /** 关注列表：同粉丝列表可见性 */
  async listFollowing(
    idOrUsername: string,
    viewer: CurrentAuthUser,
    page: number,
    pageSize: number,
  ): Promise<Page<FollowUserView>> {
    const row = await this.resolveUser(idOrUsername);
    if (viewer.role === Role.VISITOR && viewer.id !== row.id) {
      throw new ForbiddenException('无权访问该资源');
    }
    const { rows, total } = await this.usersRepository.listFollowing(row.id, page, pageSize);
    return this.toFollowUserPage(rows, viewer, total, page, pageSize);
  }
}

/** activity 聚合口径：五类事件按日求和，按日期升序 */
export function mergeActivityParts(parts: ActivityParts): { date: string; count: number }[] {
  const merged = new Map<string, number>();
  for (const days of Object.values(parts)) {
    for (const d of days) {
      merged.set(d.date, (merged.get(d.date) ?? 0) + d.count);
    }
  }
  return [...merged.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 站内连击：UTC 日连续有贡献的天数；今天没活动则从昨天起算（与 GitHub streak 口径一致） */
export function computeStreak(days: { date: string; count: number }[], today: Date = new Date()): number {
  const active = new Set(days.filter((d) => d.count > 0).map((d) => d.date));
  const cursor = new Date(today);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  if (!active.has(key(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  let streak = 0;
  while (active.has(key(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
