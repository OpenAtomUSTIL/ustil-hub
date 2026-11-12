import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { IssueStatus, issueReplies, issues } from '../../db/schema';

export type IssueRow = typeof issues.$inferSelect;
export type ReplyRow = typeof issueReplies.$inferSelect;
export type ReplyWithIssueRow = ReplyRow & { issueTitle: string };

const REPLIES_LIMIT = 100;

@Injectable()
export class IssuesRepository {
  async list(
    page: number,
    pageSize: number,
    filters: {
      status?: IssueStatus;
      keyword?: string;
      authorId?: string;
      tagTargetIds?: string[];
    },
  ): Promise<{ rows: IssueRow[]; total: number }> {
    const conditions = [];
    if (filters.status) {
      conditions.push(eq(issues.status, filters.status));
    }
    if (filters.authorId) {
      conditions.push(eq(issues.authorId, filters.authorId));
    }
    const trimmed = filters.keyword?.trim();
    if (trimmed) {
      const pattern = `%${trimmed}%`;
      conditions.push(or(ilike(issues.title, pattern), ilike(issues.content, pattern)));
    }
    if (filters.tagTargetIds) {
      if (filters.tagTargetIds.length === 0) {
        return { rows: [], total: 0 };
      }
      conditions.push(inArray(issues.id, filters.tagTargetIds));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(issues)
      .where(where)
      .orderBy(desc(issues.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(issues).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async findById(id: string): Promise<IssueRow | null> {
    const rows = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async insert(row: { title: string; content: string; authorId: string }): Promise<IssueRow> {
    const inserted = await db.insert(issues).values(row).returning();
    return inserted[0];
  }

  async updateStatus(
    id: string,
    patch: { status: IssueStatus; answeredBy: string | null; answeredAt: Date | null },
  ): Promise<IssueRow | null> {
    const rows = await db.update(issues).set(patch).where(eq(issues.id, id)).returning();
    return rows[0] ?? null;
  }

  async findReplies(issueId: string): Promise<ReplyRow[]> {
    // 软删回复不展示
    return db
      .select()
      .from(issueReplies)
      .where(and(eq(issueReplies.issueId, issueId), isNull(issueReplies.deletedAt)))
      .orderBy(issueReplies.createdAt)
      .limit(REPLIES_LIMIT);
  }

  async insertReply(row: {
    issueId: string;
    authorId: string;
    content: string;
  }): Promise<ReplyRow> {
    const inserted = await db.insert(issueReplies).values(row).returning();
    return inserted[0];
  }

  async countReplies(issueIds: string[]): Promise<Map<string, number>> {
    if (issueIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ issueId: issueReplies.issueId, count: sql<number>`count(*)::int` })
      .from(issueReplies)
      .where(and(inArray(issueReplies.issueId, issueIds), isNull(issueReplies.deletedAt)))
      .groupBy(issueReplies.issueId);
    return new Map(rows.map((row) => [row.issueId, row.count]));
  }

  // ===== 管理端评论 / 回收站 =====

  async findReplyById(id: string): Promise<ReplyRow | null> {
    const rows = await db.select().from(issueReplies).where(eq(issueReplies.id, id)).limit(1);
    return rows[0] ?? null;
  }

  // 软删除：置 deleted_at；FK 级联（剔除学员/删 issue）仍为硬删
  async softDeleteReply(id: string): Promise<ReplyRow | null> {
    const rows = await db
      .update(issueReplies)
      .set({ deletedAt: new Date() })
      .where(and(eq(issueReplies.id, id), isNull(issueReplies.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  async restoreReply(id: string): Promise<ReplyRow | null> {
    const rows = await db
      .update(issueReplies)
      .set({ deletedAt: null })
      .where(and(eq(issueReplies.id, id), isNotNull(issueReplies.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  private replyWithIssueSelect() {
    return {
      id: issueReplies.id,
      issueId: issueReplies.issueId,
      issueTitle: issues.title,
      authorId: issueReplies.authorId,
      content: issueReplies.content,
      createdAt: issueReplies.createdAt,
      updatedAt: issueReplies.updatedAt,
      deletedAt: issueReplies.deletedAt,
    };
  }

  // 评论管理：含软删行（deletedAt 展示）；keyword 搜内容或作者 id 命中集
  async listRepliesForAdmin(params: {
    keyword?: string;
    authorIds?: string[];
    page: number;
    pageSize: number;
  }): Promise<{ rows: ReplyWithIssueRow[]; total: number }> {
    const conditions = [];
    const trimmed = params.keyword?.trim();
    if (trimmed) {
      const parts = [ilike(issueReplies.content, `%${trimmed}%`)];
      if (params.authorIds && params.authorIds.length > 0) {
        parts.push(inArray(issueReplies.authorId, params.authorIds));
      }
      conditions.push(or(...parts));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select(this.replyWithIssueSelect())
      .from(issueReplies)
      .innerJoin(issues, eq(issues.id, issueReplies.issueId))
      .where(where)
      .orderBy(desc(issueReplies.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(issueReplies)
      .innerJoin(issues, eq(issues.id, issueReplies.issueId))
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  // 回收站：仅软删行，deleted_at desc
  async listDeletedReplies(
    page: number,
    pageSize: number,
  ): Promise<{ rows: ReplyWithIssueRow[]; total: number }> {
    const where = isNotNull(issueReplies.deletedAt);
    const rows = await db
      .select(this.replyWithIssueSelect())
      .from(issueReplies)
      .innerJoin(issues, eq(issues.id, issueReplies.issueId))
      .where(where)
      .orderBy(desc(issueReplies.deletedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(issueReplies)
      .innerJoin(issues, eq(issues.id, issueReplies.issueId))
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }
}
