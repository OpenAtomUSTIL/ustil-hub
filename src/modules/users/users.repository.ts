import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, like, lt, ne, or, sql } from 'drizzle-orm';
import { db, Database } from '../../db';
import { UserStatus, users } from '../../db/schema';

export type UserRow = typeof users.$inferSelect;

@Injectable()
export class UsersRepository {
  /** 头像来源归用户模块所有；过滤空 key，确保列表与总数条件一致。 */
  adminFileSource(connection: Pick<Database, 'select'>, keyword?: string) {
    const trimmed = keyword?.trim();
    return connection.select({
      kind: sql<'ATTACHMENT' | 'AVATAR'>`'AVATAR'::text`.as('kind'),
      id: users.id,
      key: sql<string>`substring(${users.avatarUrl} from 23)`.as('key'),
      fileName: sql<string>`substring(${users.avatarUrl} from 23)`.as('file_name'),
      size: sql<number>`0::integer`.as('size'),
      uploaderId: sql<string>`${users.id}`.as('uploader_id'),
      email: users.email,
      createdAt: sql`${users.updatedAt}`.mapWith(users.updatedAt).as('created_at'),
    }).from(users).where(and(
      like(users.avatarUrl, '/api/v1/storage/files/_%'),
      trimmed ? ilike(users.avatarUrl, `%${trimmed}%`) : undefined,
    ));
  }

  async insert(row: {
    email: string | null;
    phone: string | null;
    passwordHash: string;
    nickname: string;
    role?: UserRow['role'];
    inviteCodeId?: string | null;
  }): Promise<UserRow> {
    const inserted = await db.insert(users).values(row).returning();
    return inserted[0];
  }

  async findById(id: string): Promise<UserRow | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByIds(ids: string[]): Promise<UserRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return db.select().from(users).where(inArray(users.id, ids));
  }

  async findByEmailOrPhone(identifier: string): Promise<UserRow | null> {
    const rows = await db
      .select()
      .from(users)
      .where(or(eq(users.email, identifier), eq(users.phone, identifier)))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateProfile(
    id: string,
    patch: { nickname?: string; avatarUrl?: string | null },
  ): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updateIdentifier(
    id: string,
    patch: { email: string | null; phone: string | null },
  ): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, id));
  }

  async invalidateSessions(id: string, expectedVersion?: number): Promise<boolean> {
    const rows = await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(and(eq(users.id, id), expectedVersion === undefined ? undefined : eq(users.sessionVersion, expectedVersion)))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async updateStatus(id: string, status: UserStatus): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ status, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(and(eq(users.id, id), ne(users.role, 'ADMIN')))
      .returning();
    return rows[0] ?? null;
  }

  async listForAdmin(params: {
    keyword?: string;
    role?: UserRow['role'];
    status?: UserStatus;
    page: number;
    pageSize: number;
  }): Promise<{ rows: UserRow[]; total: number }> {
    const conditions = [];
    if (params.keyword) {
      const pattern = `%${params.keyword}%`;
      conditions.push(
        or(
          ilike(users.nickname, pattern),
          ilike(users.email, pattern),
          ilike(users.phone, pattern),
        ),
      );
    }
    if (params.role) {
      conditions.push(eq(users.role, params.role));
    }
    if (params.status) {
      conditions.push(eq(users.status, params.status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async updateRole(id: string, role: Exclude<UserRow['role'], 'ADMIN'>, expectedRole: UserRow['role']): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ role, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(and(eq(users.id, id), eq(users.role, expectedRole), ne(users.role, 'ADMIN')))
      .returning();
    return rows[0] ?? null;
  }

  async deleteById(id: string): Promise<UserRow | null> {
    const rows = await db.delete(users).where(and(eq(users.id, id), inArray(users.role, ['MEMBER', 'VISITOR']))).returning();
    return rows[0] ?? null;
  }

  async countByRole(): Promise<Record<string, number>> {
    const rows = await db
      .select({ role: users.role, count: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.role);
    return Object.fromEntries(rows.map((row) => [row.role, row.count]));
  }

  async countVisitorsCreatedBefore(before: Date): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'VISITOR'), lt(users.createdAt, before)));
    return rows[0]?.count ?? 0;
  }

  // 定时清理：删除满 7 天的 VISITOR（级联其讨论/提交），返回被删 id
  async deleteVisitorsCreatedBefore(before: Date): Promise<string[]> {
    const rows = await db
      .delete(users)
      .where(and(eq(users.role, 'VISITOR'), lt(users.createdAt, before)))
      .returning({ id: users.id });
    return rows.map((row) => row.id);
  }

  // 定时升级：MEMBER 注册满 4 年自动升 ALUMNI，返回受影响行数
  async promoteMembersCreatedBefore(before: Date): Promise<number> {
    const rows = await db
      .update(users)
      .set({ role: 'ALUMNI', sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(and(eq(users.role, 'MEMBER'), lt(users.createdAt, before)))
      .returning({ id: users.id });
    return rows.length;
  }

  async applyInviteCode(id: string, inviteCodeId: string): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ role: 'MEMBER', inviteCodeId, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(and(eq(users.id, id), eq(users.role, 'VISITOR')))
      .returning();
    return rows[0] ?? null;
  }

  async listActiveUserIds(): Promise<string[]> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.status, 'ACTIVE'));
    return rows.map((row) => row.id);
  }

  async listIdsByRoles(roles: UserRow['role'][]): Promise<string[]> {
    if (roles.length === 0) {
      return [];
    }
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.role, roles));
    return rows.map((row) => row.id);
  }

  // 在线状态：原生参数化 SQL 更新，避免触发 updatedAt 的 $onUpdateFn
  async touchLastSeen(userId: string): Promise<void> {
    await db.execute(sql`update users set last_seen_at = now() where id = ${userId}`);
  }

  async listLastSeenSince(since: Date): Promise<UserRow[]> {
    return db
      .select()
      .from(users)
      .where(gte(users.lastSeenAt, since))
      .orderBy(desc(users.lastSeenAt));
  }

  // 头像文件盘点：仅统计指向受控存储文件的 avatar_url
  async listAvatarFiles(params: { keyword?: string; limit: number }): Promise<UserRow[]> {
    const conditions = [like(users.avatarUrl, '/api/v1/storage/files/%')];
    const trimmed = params.keyword?.trim();
    if (trimmed) {
      conditions.push(ilike(users.avatarUrl, `%${trimmed}%`));
    }
    return db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(desc(users.updatedAt))
      .limit(params.limit);
  }

  async countAvatarFiles(keyword?: string): Promise<number> {
    const conditions = [like(users.avatarUrl, '/api/v1/storage/files/%')];
    const trimmed = keyword?.trim();
    if (trimmed) {
      conditions.push(ilike(users.avatarUrl, `%${trimmed}%`));
    }
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(...conditions));
    return rows[0]?.count ?? 0;
  }

  async clearAvatar(userId: string, expectedAvatarUrl: string): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ avatarUrl: null })
      .where(and(eq(users.id, userId), eq(users.avatarUrl, expectedAvatarUrl)))
      .returning();
    return rows[0] ?? null;
  }

  // 哪些存储 key 正被 users.avatar_url 引用（文件删除前的占用检查）
  async findAvatarReferencedKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) {
      return new Set();
    }
    const rows = await db
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(
        or(
          ...keys.map((key) =>
            or(eq(users.avatarUrl, `/api/v1/storage/files/${key}`), eq(users.avatarUrl, key)),
          ),
        ),
      );
    const referenced = new Set<string>();
    for (const row of rows) {
      for (const key of keys) {
        if (row.avatarUrl === `/api/v1/storage/files/${key}` || row.avatarUrl === key) {
          referenced.add(key);
        }
      }
    }
    return referenced;
  }

  // 关键字模糊搜用户 id（管理端评论按作者搜索用），上限 100
  async searchIdsByKeyword(keyword: string): Promise<string[]> {
    const pattern = `%${keyword.trim()}%`;
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(or(ilike(users.nickname, pattern), ilike(users.email, pattern)))
      .limit(100);
    return rows.map((row) => row.id);
  }

  // 管理端展示上传者邮箱用（快照场景）
  async findEmailsByIds(ids: string[]): Promise<Map<string, string | null>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row.email]));
  }
}
