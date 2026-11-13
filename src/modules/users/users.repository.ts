import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, isNull, like, lt, ne, or, sql } from 'drizzle-orm';
import { db, Database } from '../../db';
import {
  articles,
  assignmentSubmissions,
  issueReplies,
  issues,
  resources,
  taggings,
  tags,
  userFollows,
  userUsernameHistory,
  UserStatus,
  users,
} from '../../db/schema';
import { isUuid } from '../../common/utils/identifiers';

export type UserRow = typeof users.$inferSelect;

export type PinnedItemType = 'ARTICLE' | 'ISSUE' | 'RESOURCE';

export interface PinnedTarget {
  type: PinnedItemType;
  id: string;
  slug: string;
  title: string;
  url?: string;
  ownerId: string;
}

export interface ActivityDayCount {
  date: string;
  count: number;
}

export interface ActivityParts {
  articles: ActivityDayCount[];
  issues: ActivityDayCount[];
  replies: ActivityDayCount[];
  submissions: ActivityDayCount[];
  resources: ActivityDayCount[];
}

export interface ProfileReplyRow {
  id: string;
  issueId: string;
  issueSlug: string;
  issueTitle: string;
  content: string;
  createdAt: Date;
}

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
    username: string;
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

  /** 当前 username 优先；旧 handle 回落变更历史（旧链接保留跳转） */
  async findByUsername(username: string): Promise<UserRow | null> {
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (rows[0]) {
      return rows[0];
    }
    const history = await db
      .select({ user: users })
      .from(userUsernameHistory)
      .innerJoin(users, eq(users.id, userUsernameHistory.userId))
      .where(eq(userUsernameHistory.username, username))
      .limit(1);
    return history[0]?.user ?? null;
  }

  async findByIdOrUsername(value: string): Promise<UserRow | null> {
    return isUuid(value) ? this.findById(value) : this.findByUsername(value);
  }

  /** 占用检查含历史 handle（旧 handle 不可被他人抢占） */
  async usernameExists(username: string): Promise<boolean> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (rows.length > 0) {
      return true;
    }
    const history = await db
      .select({ id: userUsernameHistory.id })
      .from(userUsernameHistory)
      .where(eq(userUsernameHistory.username, username))
      .limit(1);
    return history.length > 0;
  }

  /** 改 handle：旧 username 写入历史（保留跳转），同事务更新现值 */
  async updateUsername(
    id: string,
    username: string,
    previousUsername: string,
  ): Promise<UserRow | null> {
    return db.transaction(async (tx) => {
      await tx
        .insert(userUsernameHistory)
        .values({ userId: id, username: previousUsername })
        .onConflictDoNothing({ target: [userUsernameHistory.username] });
      const rows = await tx
        .update(users)
        .set({ username })
        .where(eq(users.id, id))
        .returning();
      return rows[0] ?? null;
    });
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

  async updateProfilePage(
    id: string,
    patch: {
      bio?: string | null;
      profileReadme?: string | null;
      pinnedItems?: { type: string; id: string }[];
    },
  ): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async getProfileStats(userId: string): Promise<{
    articles: number;
    issues: number;
    replies: number;
    submissions: number;
  }> {
    const [articleCount, issueCount, replyCount, submissionCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(articles)
        .where(and(eq(articles.authorId, userId), isNull(articles.deletedAt), eq(articles.status, 'PUBLISHED'))),
      db.select({ count: sql<number>`count(*)::int` }).from(issues)
        .where(eq(issues.authorId, userId)),
      db.select({ count: sql<number>`count(*)::int` }).from(issueReplies)
        .where(and(eq(issueReplies.authorId, userId), isNull(issueReplies.deletedAt))),
      db.select({ count: sql<number>`count(*)::int` }).from(assignmentSubmissions)
        .where(eq(assignmentSubmissions.submitterId, userId)),
    ]);

    return {
      articles: articleCount[0]?.count ?? 0,
      issues: issueCount[0]?.count ?? 0,
      replies: replyCount[0]?.count ?? 0,
      submissions: submissionCount[0]?.count ?? 0,
    };
  }

  async getProfileTopTags(userId: string, limit = 10): Promise<{ name: string; count: number }[]> {
    const articleIds = db.select({ id: articles.id }).from(articles)
      .where(and(eq(articles.authorId, userId), isNull(articles.deletedAt), eq(articles.status, 'PUBLISHED')));
    const issueIds = db.select({ id: issues.id }).from(issues).where(eq(issues.authorId, userId));
    const resourceIds = db.select({ id: resources.id }).from(resources).where(and(eq(resources.creatorId, userId), isNull(resources.deletedAt)));

    const rows = await db
      .select({ name: tags.name, count: sql<number>`count(*)::int` })
      .from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(and(inArray(taggings.targetId, articleIds), eq(taggings.targetType, 'ARTICLE')))
      .groupBy(tags.name);

    const issueTagRows = await db
      .select({ name: tags.name, count: sql<number>`count(*)::int` })
      .from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(and(inArray(taggings.targetId, issueIds), eq(taggings.targetType, 'ISSUE')))
      .groupBy(tags.name);

    const resourceTagRows = await db
      .select({ name: tags.name, count: sql<number>`count(*)::int` })
      .from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(and(inArray(taggings.targetId, resourceIds), eq(taggings.targetType, 'RESOURCE')))
      .groupBy(tags.name);

    const merged = new Map<string, number>();
    for (const r of rows) {
      const prev = merged.get(r.name) || 0;
      merged.set(r.name, prev + r.count);
    }
    for (const r of issueTagRows) {
      const prev = merged.get(r.name) || 0;
      merged.set(r.name, prev + r.count);
    }
    for (const r of resourceTagRows) {
      const prev = merged.get(r.name) || 0;
      merged.set(r.name, prev + r.count);
    }

    return [...merged.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /** 五类事件按 UTC 日聚合（软删不计），按类型分开返回，合并口径在 service 层 */
  async getActivityParts(userId: string, since: Date): Promise<ActivityParts> {
    const articleDay = sql<string>`to_char(${articles.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const issueDay = sql<string>`to_char(${issues.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const replyDay = sql<string>`to_char(${issueReplies.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const subDay = sql<string>`to_char(${assignmentSubmissions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const resDay = sql<string>`to_char(${resources.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

    const [articleDays, issueDays, replyDays, subDays, resDays] = await Promise.all([
      db.select({ date: articleDay, count: sql<number>`count(*)::int` })
        .from(articles)
        .where(and(eq(articles.authorId, userId), isNull(articles.deletedAt), eq(articles.status, 'PUBLISHED'), gte(articles.createdAt, since)))
        .groupBy(articleDay),
      db.select({ date: issueDay, count: sql<number>`count(*)::int` })
        .from(issues)
        .where(and(eq(issues.authorId, userId), gte(issues.createdAt, since)))
        .groupBy(issueDay),
      db.select({ date: replyDay, count: sql<number>`count(*)::int` })
        .from(issueReplies)
        .where(and(eq(issueReplies.authorId, userId), isNull(issueReplies.deletedAt), gte(issueReplies.createdAt, since)))
        .groupBy(replyDay),
      db.select({ date: subDay, count: sql<number>`count(*)::int` })
        .from(assignmentSubmissions)
        .where(and(eq(assignmentSubmissions.submitterId, userId), gte(assignmentSubmissions.createdAt, since)))
        .groupBy(subDay),
      db.select({ date: resDay, count: sql<number>`count(*)::int` })
        .from(resources)
        .where(and(eq(resources.creatorId, userId), isNull(resources.deletedAt), gte(resources.createdAt, since)))
        .groupBy(resDay),
    ]);

    return {
      articles: articleDays,
      issues: issueDays,
      replies: replyDays,
      submissions: subDays,
      resources: resDays,
    };
  }

  /** 置顶目标解析：仅返回存在且未软删的目标（含归属），软删目标静默跳过 */
  async findPinnedTargets(items: { type: string; id: string }[]): Promise<PinnedTarget[]> {
    const result: PinnedTarget[] = [];
    const idsByType = new Map<PinnedItemType, string[]>();
    for (const item of items) {
      if (item.type !== 'ARTICLE' && item.type !== 'ISSUE' && item.type !== 'RESOURCE') continue;
      const list = idsByType.get(item.type) ?? [];
      list.push(item.id);
      idsByType.set(item.type, list);
    }

    const articleIds = idsByType.get('ARTICLE') ?? [];
    if (articleIds.length > 0) {
      const rows = await db
        .select({ id: articles.id, slug: articles.slug, title: articles.title, ownerId: articles.authorId })
        .from(articles)
        .where(and(inArray(articles.id, articleIds), isNull(articles.deletedAt), eq(articles.status, 'PUBLISHED')));
      for (const r of rows) {
        result.push({ type: 'ARTICLE', id: r.id, slug: r.slug, title: r.title, ownerId: r.ownerId });
      }
    }

    const issueIds = idsByType.get('ISSUE') ?? [];
    if (issueIds.length > 0) {
      const rows = await db
        .select({ id: issues.id, slug: issues.slug, title: issues.title, ownerId: issues.authorId })
        .from(issues)
        .where(inArray(issues.id, issueIds));
      for (const r of rows) {
        result.push({ type: 'ISSUE', id: r.id, slug: r.slug, title: r.title, ownerId: r.ownerId });
      }
    }

    const resourceIds = idsByType.get('RESOURCE') ?? [];
    if (resourceIds.length > 0) {
      const rows = await db
        .select({ id: resources.id, slug: resources.slug, title: resources.title, url: resources.url, ownerId: resources.creatorId })
        .from(resources)
        .where(and(inArray(resources.id, resourceIds), isNull(resources.deletedAt)));
      for (const r of rows) {
        result.push({ type: 'RESOURCE', id: r.id, slug: r.slug, title: r.title, url: r.url, ownerId: r.ownerId });
      }
    }

    return result;
  }

  /** 某用户的讨论回复（软删不计），带所属讨论标题，按创建时间倒序 */
  async listRepliesByAuthor(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: ProfileReplyRow[]; total: number }> {
    const where = and(eq(issueReplies.authorId, userId), isNull(issueReplies.deletedAt));
    const rows = await db
      .select({
        id: issueReplies.id,
        issueId: issueReplies.issueId,
        issueSlug: issues.slug,
        issueTitle: issues.title,
        content: issueReplies.content,
        createdAt: issueReplies.createdAt,
      })
      .from(issueReplies)
      .innerJoin(issues, eq(issues.id, issueReplies.issueId))
      .where(where)
      .orderBy(desc(issueReplies.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(issueReplies).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  // ===== 关注 =====

  /** 幂等关注：已关注返回 false（未产生新行） */
  async insertFollow(followerId: string, followeeId: string): Promise<boolean> {
    const inserted = await db
      .insert(userFollows)
      .values({ followerId, followeeId })
      .onConflictDoNothing({ target: [userFollows.followerId, userFollows.followeeId] })
      .returning({ id: userFollows.id });
    return inserted.length > 0;
  }

  async deleteFollow(followerId: string, followeeId: string): Promise<boolean> {
    const deleted = await db
      .delete(userFollows)
      .where(and(eq(userFollows.followerId, followerId), eq(userFollows.followeeId, followeeId)))
      .returning({ id: userFollows.id });
    return deleted.length > 0;
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const rows = await db
      .select({ id: userFollows.id })
      .from(userFollows)
      .where(and(eq(userFollows.followerId, followerId), eq(userFollows.followeeId, followeeId)))
      .limit(1);
    return rows.length > 0;
  }

  /** 计数口径：对方 ACTIVE 才计入（封禁不展示、不计数） */
  async getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
    const [followers, following] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userFollows)
        .innerJoin(users, eq(users.id, userFollows.followerId))
        .where(and(eq(userFollows.followeeId, userId), eq(users.status, 'ACTIVE'))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userFollows)
        .innerJoin(users, eq(users.id, userFollows.followeeId))
        .where(and(eq(userFollows.followerId, userId), eq(users.status, 'ACTIVE'))),
    ]);
    return { followers: followers[0]?.count ?? 0, following: following[0]?.count ?? 0 };
  }

  async listFollowers(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: UserRow[]; total: number }> {
    const where = and(eq(userFollows.followeeId, userId), eq(users.status, 'ACTIVE'));
    const joined = await db
      .select({ user: users })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followerId))
      .where(where)
      .orderBy(desc(userFollows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followerId))
      .where(where);
    return { rows: joined.map((r) => r.user), total: totalRows[0]?.count ?? 0 };
  }

  async listFollowing(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: UserRow[]; total: number }> {
    const where = and(eq(userFollows.followerId, userId), eq(users.status, 'ACTIVE'));
    const joined = await db
      .select({ user: users })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followeeId))
      .where(where)
      .orderBy(desc(userFollows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followeeId))
      .where(where);
    return { rows: joined.map((r) => r.user), total: totalRows[0]?.count ?? 0 };
  }

  /** viewer 已关注的 id 集合（列表批量标注用） */
  async filterFollowedIds(viewerId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = await db
      .select({ followeeId: userFollows.followeeId })
      .from(userFollows)
      .where(and(eq(userFollows.followerId, viewerId), inArray(userFollows.followeeId, ids)));
    return new Set(rows.map((r) => r.followeeId));
  }
}
