import { Inject, Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { verify } from 'argon2';
import { isEmail, isMobilePhone } from 'class-validator';
import { Role } from '../../common/decorators/roles.decorator';
import { REFRESH_TOKEN_STORE, RefreshTokenStore } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { UploadsService, UploadedFileInput } from '../storage/uploads.service';
import { ChangeIdentifierDto } from './dto/change-identifier.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersRepository, UserRow } from './users.repository';
import { AdminUserPage, AdminUserView, AuthUser, UserAuthRecord, UserPublic, UserSelf } from './users.views';

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
    return row ? { id: row.id, role: row.role as Role, status: row.status } : null;
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
    const updated = await this.usersRepository.updateIdentifier(id, {
      email: dto.type === 'email' ? value : null,
      phone: dto.type === 'phone' ? value : null,
    });
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

  async ban(id: string): Promise<{ id: string; status: UserStatus }> {
    const row = await this.usersRepository.updateStatus(id, UserStatus.BANNED);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    // 封禁立即吊销全部 refresh token
    await this.refreshStore.revokeAll(id);
    return { id: row.id, status: row.status };
  }

  async unban(id: string): Promise<{ id: string; status: UserStatus }> {
    const row = await this.usersRepository.updateStatus(id, UserStatus.ACTIVE);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
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
  }): Promise<AdminUserPage> {
    const { rows, total } = await this.usersRepository.listForAdmin(query);
    return {
      items: rows.map((row) => this.toAdminView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async updateRole(id: string, role: Exclude<Role, 'ADMIN'>): Promise<AdminUserView> {
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role === Role.ADMIN) {
      throw new ForbiddenException('不可修改管理员账号');
    }
    const updated = await this.usersRepository.updateRole(id, role);
    if (!updated) {
      throw new NotFoundException('用户不存在');
    }
    // 角色变更后强制重登（旧 token 内含旧角色）
    await this.refreshStore.revokeAll(id);
    return this.toAdminView(updated);
  }

  async promoteToAlumni(id: string): Promise<AdminUserView> {
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role !== Role.MEMBER) {
      throw new ForbiddenException('仅学习成员可提前提拔');
    }
    const updated = await this.usersRepository.updateRole(id, Role.ALUMNI);
    if (!updated) {
      throw new NotFoundException('用户不存在');
    }
    await this.refreshStore.revokeAll(id);
    return this.toAdminView(updated);
  }

  async removeByAdmin(id: string): Promise<void> {
    const row = await this.usersRepository.findById(id);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    if (row.role !== Role.MEMBER && row.role !== Role.VISITOR) {
      throw new ForbiddenException('仅可剔除学习成员或临时访客');
    }
    await this.refreshStore.revokeAll(id);
    await this.usersRepository.deleteById(id);
  }

  async countByRole(): Promise<Record<string, number>> {
    return this.usersRepository.countByRole();
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
