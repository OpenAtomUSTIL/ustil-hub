import { Database } from '../../db';
import { Inject, Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { verify } from 'argon2';
import { isEmail, isMobilePhone } from 'class-validator';
import { Role } from '../../common/decorators/roles.decorator';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Page } from '../../common/dto/page';
import { USERNAME_RE, uniqueUsername } from '../../common/utils/identifiers';
import { requireRole } from '../../common/permissions';
import { REFRESH_TOKEN_STORE, RefreshTokenStore } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TagsService } from '../tags/tags.service';
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
      username: row.username,
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
      username: row.username,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      role: row.role as Role,
    };
  }

  adminFileSource(connection: Pick<Database, 'select'>, keyword?: string) {
    return this.usersRepository.adminFileSource(connection, keyword);
  }

  async createUser(input: {
    email?: string | null;
    phone?: string | null;
    passwordHash: string;
    nickname: string;
    role?: Role;
    inviteCodeId?: string | null;
  }): Promise<UserSelf> {
    const username = await uniqueUsername(input.nickname, (u) =>
      this.usersRepository.usernameExists(u),
    );
    try {
      const row = await this.usersRepository.insert({
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash: input.passwordHash,
        nickname: input.nickname,
        username,
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
      bio: row.bio,
      profileReadme: row.profileReadme,
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
      if (row.email) profile.email = row.email;
      if (row.phone) profile.phone = row.phone;
    }
    return profile;
  }

  async updateProfilePage(
    userId: string,
    dto: {
      bio?: string | null;
      profileReadme?: string | null;
      pinnedItems?: { type: string; id: string }[];
    },
  ): Promise<void> {
    if (dto.bio !== undefined && dto.bio !== null && dto.bio.length > 100) {
      throw new BadRequestException('bio 不能超过 100 个字符');
    }
    if (dto.profileReadme !== undefined && dto.profileReadme !== null && dto.profileReadme.length > 10000) {
      throw new BadRequestException('个人介绍不能超过 10000 个字符');
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
    const row = await this.usersRepository.updateProfilePage(userId, dto);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
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
    const current = await this.usersRepository.findById(userId);
    if (!current) {
      throw new NotFoundException('用户不存在');
    }
    if (current.username === username) {
      return this.toSelf(current);
    }
    if (await this.usersRepository.usernameExists(username)) {
      throw new ConflictException('该用户名已被占用');
    }
    let updated: UserRow | null;
    try {
      updated = await this.usersRepository.updateUsername(userId, username, current.username);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('该用户名已被占用');
      throw error;
    }
    if (!updated) {
      throw new NotFoundException('用户不存在');
    }
    return this.toSelf(updated);
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
      bio: row.bio,
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
