import { Inject, Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { verify } from 'argon2';
import { isEmail, isMobilePhone } from 'class-validator';
import { Role } from '../../common/decorators/roles.decorator';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { requireRole } from '../../common/permissions';
import { REFRESH_TOKEN_STORE, RefreshTokenStore } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TagsService } from '../tags/tags.service';
import { UploadsService, UploadedFileInput } from '../storage/uploads.service';
import { ChangeIdentifierDto } from './dto/change-identifier.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersRepository, UserRow } from './users.repository';
import {
  AdminUserPage,
  AdminUserView,
  AuthUser,
  AvatarFileRef,
  UserAuthRecord,
  UserPublic,
  UserSelf,
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
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly uploadsService: UploadsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly tagsService: TagsService,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshStore: RefreshTokenStore,
  ) {}

  private toSelf(row: UserRow): UserSelf {
    const self: UserSelf = {
      id: row.id,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    if (row.email) {
      self.email = row.email;
    }
    if (row.phone) {
      self.phone = row.phone;
    }
    return self;
  }

  private toPublic(row: UserRow): UserPublic {
    return {
      id: row.id,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
    };
  }

  async createUser(input: {
    email?: string | null;
    phone?: string | null;
    passwordHash: string;
    nickname: string;
    role?: Role;
    inviteCodeId?: string | null;
  }): Promise<UserSelf> {
    try {
      const row = await this.usersRepository.insert({
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash: input.passwordHash,
        nickname: input.nickname,
        ...(input.role ? { role: input.role } : {}),
        inviteCodeId: input.inviteCodeId ?? null,
      });
      return this.toSelf(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('该邮箱或手机号已被注册');
      }
      throw error;
    }
  }

  async findByIdentifier(identifier: string): Promise<UserAuthRecord | null> {
    const row = await this.usersRepository.findByEmailOrPhone(normalizeIdentifier(identifier));
    return row ? this.toAuthRecord(row) : null;
  }

  async getAuthRecordById(id: string): Promise<UserAuthRecord | null> {
    const row = await this.usersRepository.findById(id);
    return row ? this.toAuthRecord(row) : null;
  }

  private toAuthRecord(row: UserRow): UserAuthRecord {
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
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
          email: row.email,
        }
      : null;
  }

  async getPublic(id: string): Promise<UserPublic> {
    const row = await this.usersRepository.findById(id);
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
    } else if (!isMobilePhone(value, 'zh-CN')) {
      throw new BadRequestException('手机号格式错误');
    }
    const existing = await this.usersRepository.findByEmailOrPhone(value);
    if (existing && existing.id !== id) {
      throw new ConflictException('该邮箱或手机号已被占用');
    }
    // 一个账号只绑定一个标识：换绑时清空另一种标识
    let updated: UserRow | null;
    try {
      updated = await this.usersRepository.updateIdentifier(id, {
        email: dto.type === 'email' ? value : null,
        phone: dto.type === 'phone' ? value : null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('该邮箱或手机号已被占用');
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

  async invalidateSessions(id: string, expectedVersion?: number): Promise<void> {
    if (await this.usersRepository.invalidateSessions(id, expectedVersion)) {
      await this.refreshStore.revokeAll(id);
    }
  }

  private async requireNonAdmin(id: string): Promise<UserRow> {
    const row = await this.usersRepository.findById(id);
    if (!row) throw new NotFoundException('用户不存在');
    if (row.role === Role.ADMIN) throw new ForbiddenException('不可修改管理员账号');
    return row;
  }

  async ban(id: string, actor: CurrentAuthUser): Promise<{ id: string; status: UserStatus }> {
    requireRole(actor, Role.ADMIN);
    await this.requireNonAdmin(id);
    const row = await this.usersRepository.updateStatus(id, UserStatus.BANNED);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    // 封禁立即吊销全部 refresh token
    await this.refreshStore.revokeAll(id);
    await this.auditLogService.record({
      actor,
      action: 'user.ban',
      targetType: 'USER',
      targetId: id,
      detail: { from: 'ACTIVE', to: 'BANNED' },
    });
    return { id: row.id, status: row.status };
  }

  async unban(id: string, actor: CurrentAuthUser): Promise<{ id: string; status: UserStatus }> {
    requireRole(actor, Role.ADMIN);
    await this.requireNonAdmin(id);
    const row = await this.usersRepository.updateStatus(id, UserStatus.ACTIVE);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    await this.auditLogService.record({
      actor,
      action: 'user.unban',
      targetType: 'USER',
      targetId: id,
      detail: { from: 'BANNED', to: 'ACTIVE' },
    });
    return { id: row.id, status: row.status };
  }

  // ===== 管理后台 =====

  private toAdminView(row: UserRow): AdminUserView {
    let contact: string | null = null;
    if (row.email) {
      const [local, domain] = row.email.split('@');
      contact = `${local.slice(0, 1)}***@${domain}`;
    } else if (row.phone) {
      contact =
        row.phone.length >= 7
          ? `${row.phone.slice(0, 3)}****${row.phone.slice(-4)}`
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

  async updateRole(id: string, role: Exclude<Role, 'ADMIN'>, actor: CurrentAuthUser): Promise<AdminUserView> {
    requireRole(actor, Role.ADMIN);
    if (![Role.VISITOR, Role.MEMBER, Role.ALUMNI, Role.WHEEL].includes(role)) {
      throw new BadRequestException('不允许授予该角色');
    }
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role === Role.ADMIN) {
      throw new ForbiddenException('不可修改管理员账号');
    }
    const updated = await this.usersRepository.updateRole(id, role, row.role);
    if (!updated) {
      throw new ConflictException('用户角色已变化，请刷新后重试');
    }
    // 角色变更后强制重登（旧 token 内含旧角色）
    await this.refreshStore.revokeAll(id);
    await this.notificationsService.notifyUser(id, {
      type: 'ROLE',
      title: '角色变更',
      body: `你的角色已从 ${row.role} 变更为 ${role}`,
    });
    await this.auditLogService.record({
      actor,
      action: 'user.role.change',
      targetType: 'USER',
      targetId: id,
      detail: { from: row.role, to: role },
    });
    return this.toAdminView(updated);
  }

  async promoteToAlumni(id: string, actor: CurrentAuthUser): Promise<AdminUserView> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role !== Role.MEMBER) {
      throw new ForbiddenException('仅学习成员可提前提拔');
    }
    const updated = await this.usersRepository.updateRole(id, Role.ALUMNI, Role.MEMBER);
    if (!updated) {
      throw new ConflictException('用户角色已变化，请刷新后重试');
    }
    await this.refreshStore.revokeAll(id);
    await this.notificationsService.notifyUser(id, {
      type: 'ROLE',
      title: '角色变更',
      body: '你的角色已从 MEMBER 变更为 ALUMNI',
    });
    await this.auditLogService.record({
      actor,
      action: 'user.promote',
      targetType: 'USER',
      targetId: id,
      detail: { from: 'MEMBER', to: 'ALUMNI' },
    });
    return this.toAdminView(updated);
  }

  async removeByAdmin(id: string, actor: CurrentAuthUser): Promise<void> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role !== Role.MEMBER && row.role !== Role.VISITOR) {
      throw new ForbiddenException('仅可剔除学习成员或临时访客');
    }
    await this.refreshStore.revokeAll(id);
    // 级联删除其 issues 前显式清理对应 taggings（无多态 FK）
    await this.tagsService.cleanupIssuesOfAuthor(id);
    const deleted = await this.usersRepository.deleteById(id);
    if (!deleted) throw new ConflictException('用户角色已变化，请刷新后重试');
    await this.auditLogService.record({
      actor,
      action: 'user.remove',
      targetType: 'USER',
      targetId: id,
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
          email: row.email,
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
    await this.usersRepository.clearAvatar(userId);
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

  /** 管理端上传者邮箱展示 */
  async getEmailsByIds(ids: string[]): Promise<Map<string, string | null>> {
    return this.usersRepository.findEmailsByIds(ids);
  }

  /** 按昵称/邮箱模糊搜用户 id（管理端评论按作者搜索用） */
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
    const ids = await this.usersRepository.deleteVisitorsCreatedBefore(cutoff);
    for (const id of ids) {
      await this.refreshStore.revokeAll(id);
    }
    return ids.length;
  }

  /** 定时任务：MEMBER 注册满 4 年自动升 ALUMNI */
  async promoteExpiredMembers(): Promise<number> {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 4);
    return this.usersRepository.promoteMembersCreatedBefore(cutoff);
  }
}
