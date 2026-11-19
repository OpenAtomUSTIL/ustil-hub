import { isValidStorageKey } from '../storage/storage.types';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, like, lt, ne, or, sql } from 'drizzle-orm';
import { db, Database, type DatabaseTransaction } from '../../db';
import {
  announcements,
  attachments,
  fileDeletions,
  articles,
  assignmentSubmissions,
  assignments,
  issueReplies,
  issues,
  resources,
  taggings,
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
      // v10.0：email 列是信封 token 不允许流出；此处仅 null 占位保持 union 列形一致，
      // 展示邮箱由调用方经 getEmailsByIds 解密回填
      email: sql<string | null>`null::text`.as('email'),
      createdAt: sql`${users.updatedAt}`.mapWith(users.updatedAt).as('created_at'),
    }).from(users).where(and(
      like(users.avatarUrl, '/api/v1/storage/files/_%'),
      trimmed ? ilike(users.avatarUrl, `%${trimmed}%`) : undefined,
    ));
  }

  async withUsernameLock<T>(operation: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      // 当前用户名与历史用户名跨两张表，共用事务锁保护名称分配。
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ustil:usernames'))`);
      return operation(tx);
    });
  }

  /** 加密字段的读取、cryptoId 初始化和写入必须持有同一用户行锁。 */
  async withUserLock<T>(
    id: string,
    operation: (row: UserRow | null, tx: DatabaseTransaction) => Promise<T>,
    connection: Database | DatabaseTransaction = db,
  ): Promise<T> {
    return connection.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      return operation(row ?? null, tx);
    });
  }

  async insert(row: {
    email: string | null;
    phone: string | null;
    // 信封加密（v10.0）：email/phone 传入信封 token，cryptoId 参与密钥派生，hmac 列供精确查找/唯一约束
    cryptoId: string;
    emailHmac: string | null;
    phoneHmac: string | null;
    passwordHash: string;
    nickname: string;
    username: string;
    role?: UserRow['role'];
    inviteCodeId?: string | null;
    emailVerifiedAt?: Date | null;
  }, connection: Database | DatabaseTransaction = db): Promise<UserRow> {
    const inserted = await connection.insert(users).values(row).returning();
    return inserted[0];
  }

  async findById(id: string, connection: Database | DatabaseTransaction = db): Promise<UserRow | null> {
    const rows = await connection.select().from(users).where(eq(users.id, id)).limit(1);
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
  async usernameExists(username: string, connection: Database | DatabaseTransaction = db): Promise<boolean> {
    const rows = await connection
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (rows.length > 0) {
      return true;
    }
    const history = await connection
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
    connection: DatabaseTransaction,
  ): Promise<UserRow | null> {
    return connection.transaction(async (tx) => {
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

  /** 注册占用检查：同时覆盖 HMAC 命中和升级后尚未回填查找列的账号。 */
  async findIdentifierCandidates(
    emailHmac: string | null,
    phoneHmac: string | null,
    connection: Database | DatabaseTransaction = db,
  ): Promise<UserRow[]> {
    return connection.select().from(users).where(or(
      emailHmac ? or(eq(users.emailHmac, emailHmac), and(isNull(users.emailHmac), isNotNull(users.email))) : undefined,
      phoneHmac ? or(eq(users.phoneHmac, phoneHmac), and(isNull(users.phoneHmac), isNotNull(users.phone))) : undefined,
    ));
  }

  /** 精确查找（v10.0）：email/phone 列为信封 token，查询走确定性 HMAC 查找列 */
  async findByEmailHmacOrPhoneHmac(emailHmac: string, phoneHmac: string): Promise<UserRow | null> {
    const rows = await db
      .select()
      .from(users)
      .where(or(eq(users.emailHmac, emailHmac), eq(users.phoneHmac, phoneHmac)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmailHmac(emailHmac: string): Promise<UserRow | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.emailHmac, emailHmac))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPhoneHmac(phoneHmac: string): Promise<UserRow | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.phoneHmac, phoneHmac))
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
    patch: {
      // v12.0：手机号改可选附加绑定——只更新传入的字段，未传字段保持不变
      email?: string | null;
      phone?: string | null;
      // 换绑（v10.0）：hmac 查找列与信封 token 同步更新/清空；cryptoId 仅在存量行缺失时补写
      emailHmac?: string | null;
      phoneHmac?: string | null;
      emailVerifiedAt?: Date | null;
      cryptoId?: string;
    },
    connection: Database | DatabaseTransaction = db,
  ): Promise<UserRow | null> {
    const rows = await connection
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** 通知邮件偏好（v12.0） */
  async updateNoticePref(id: string, emailNoticeEnabled: boolean): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ emailNoticeEnabled })
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
      // 模糊搜只搜昵称/用户名（v10.0 已拍板）：email/phone 加密后不可 ilike，退出 keyword 模糊搜
      conditions.push(
        or(
          ilike(users.nickname, pattern),
          ilike(users.username, pattern),
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

  /**
   * 剔除学员（v8.0 修复）：单事务 purge——名下文章/公告/资料/作业（含回收站软删行）与账号一并硬删，
   * 避免 RESTRICT 外键把 DELETE 顶成 500。已有他人提交的作业改派给执行者，不连带删他人提交。
   * 顺序要点：①FOR UPDATE 锁行+角色校验最先（否则 purge 提交后删号被角色守卫挡下会白删内容）；
   * ②taggings 先于内容删除（子查询要靠内容行定位 targetId，反了会留孤儿污染标签计数）；
   * ③作业改派先于作业删除；④本人提交显式先删（消除附件级联 vs 提交 RESTRICT 的顺序不确定性）。
   */
  async deleteById(id: string, reassignedPublisherTo?: string, expiredBefore?: Date): Promise<UserRow | null> {
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ role: users.role, createdAt: users.createdAt, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      if (!locked || (locked.role !== 'MEMBER' && locked.role !== 'VISITOR')) {
        return null;
      }

      // 自动清理须在锁内再次确认仍为过期访客，避免与转正/角色变更竞争。
      if (expiredBefore && (locked.role !== 'VISITOR' || locked.createdAt >= expiredBefore)) return null;
      let publisher = reassignedPublisherTo;
      if (!publisher) {
        const [admin] = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'ADMIN')).limit(1);
        publisher = admin?.id;
        if (!publisher) {
          const protectedAssignments = await tx.select({ id: assignments.id }).from(assignments)
            .where(and(eq(assignments.publisherId, id), inArray(assignments.id,
              tx.select({ id: assignmentSubmissions.assignmentId }).from(assignmentSubmissions)
                .where(ne(assignmentSubmissions.submitterId, id)),
            ))).limit(1);
          // 未配置管理员时保留含他人提交的账号，不能为了清理而删除他人的作业。
          if (protectedAssignments.length > 0) return null;
        }
      }

      // 先登记文件删除工作，再执行级联删除，保证故障后 key 仍有记录。
      const files = await tx.select({ key: attachments.key }).from(attachments).where(eq(attachments.uploaderId, id));
      const avatarKey = locked.avatarUrl?.match(/^\/api\/v1\/storage\/files\/(.+)$/)?.[1];
      const keys = new Set(files.map((file) => file.key));
      if (avatarKey) keys.add(avatarKey);
      for (const key of keys) if (isValidStorageKey(key)) {
        await tx.insert(fileDeletions).values({ key }).onConflictDoNothing();
      }

      // taggings 无多态 FK，必须显式清理（须在内容行删除前，子查询要能命中目标）
      await tx.delete(taggings).where(
        or(
          and(
            eq(taggings.targetType, 'ARTICLE'),
            inArray(taggings.targetId, tx.select({ id: articles.id }).from(articles).where(eq(articles.authorId, id))),
          ),
          and(
            eq(taggings.targetType, 'ISSUE'),
            inArray(taggings.targetId, tx.select({ id: issues.id }).from(issues).where(eq(issues.authorId, id))),
          ),
          and(
            eq(taggings.targetType, 'RESOURCE'),
            inArray(taggings.targetId, tx.select({ id: resources.id }).from(resources).where(eq(resources.creatorId, id))),
          ),
          // 擅长标签（USER）：targetId 即用户 id
          and(eq(taggings.targetType, 'USER'), eq(taggings.targetId, id)),
        ),
      );

      // 名下内容硬删（含回收站软删行）
      await tx.delete(articles).where(eq(articles.authorId, id));
      await tx.delete(announcements).where(eq(announcements.authorId, id));
      await tx.delete(resources).where(eq(resources.creatorId, id));

      // 作业：已有他人提交的改派给执行剔除的管理员，不连带删他人提交
      if (publisher) await tx
        .update(assignments)
        .set({ publisherId: publisher })
        .where(
          and(
            eq(assignments.publisherId, id),
            inArray(
              assignments.id,
              tx
                .select({ id: assignmentSubmissions.assignmentId })
                .from(assignmentSubmissions)
                .where(ne(assignmentSubmissions.submitterId, id)),
            ),
          ),
        );
      // 无他人提交的作业连同其提交一并删除
      await tx.delete(assignments).where(eq(assignments.publisherId, id));

      // 本人提交显式先删：避免附件（uploader 级联）与提交（attachment RESTRICT）在删号级联中的顺序不确定性
      await tx.delete(assignmentSubmissions).where(eq(assignmentSubmissions.submitterId, id));

      const rows = await tx
        .delete(users)
        .where(and(eq(users.id, id), inArray(users.role, ['MEMBER', 'VISITOR'])))
        .returning();
      return rows[0] ?? null;
    });
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

  // 只列候选账号；删除必须复用 deleteById，并在事务锁内重查角色与过期时间。
  async listExpiredVisitorIds(before: Date): Promise<string[]> {
    const rows = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.role, 'VISITOR'), lt(users.createdAt, before)));
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

  // 关键字模糊搜用户 id（管理端评论按作者搜索用），上限 100；v10.0 邮箱加密后退出模糊搜，只搜昵称
  async searchIdsByKeyword(keyword: string): Promise<string[]> {
    const pattern = `%${keyword.trim()}%`;
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(ilike(users.nickname, pattern))
      .limit(100);
    return rows.map((row) => row.id);
  }

  // 管理端展示上传者邮箱用（快照场景）；v10.0 连同 cryptoId 供 service 解密
  async findEmailsByIds(ids: string[]): Promise<Map<string, { email: string | null; cryptoId: string | null }>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ id: users.id, email: users.email, cryptoId: users.cryptoId })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, { email: row.email, cryptoId: row.cryptoId }]));
  }

  async updateProfilePage(
    id: string,
    patch: {
      bio?: string | null;
      profileReadme?: string | null;
      pinnedItems?: { type: string; id: string }[];
      company?: string | null;
      location?: string | null;
      link?: string | null;
      // socials 逐条信封 token（v10.0）：空串 seal 为 null 条目原位保留，读取侧过滤；cryptoId 仅存量行缺失时补写
      socials?: (string | null)[] | null;
      cryptoId?: string;
    },
    connection: Database | DatabaseTransaction = db,
  ): Promise<UserRow | null> {
    const rows = await connection
      .update(users)
      .set({
        ...patch,
        // jsonb 列声明 string[]，null 条目（空串 seal 产物）以收窄断言入库
        socials: patch.socials as string[] | null | undefined,
      })
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
