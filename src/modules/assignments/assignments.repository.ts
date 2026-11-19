import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, type DatabaseTransaction } from '../../db';
import { assignmentSubmissions, assignments } from '../../db/schema';
import { isUuid } from '../../common/utils/identifiers';

export type AssignmentRow = typeof assignments.$inferSelect;
export type SubmissionRow = typeof assignmentSubmissions.$inferSelect;

@Injectable()
export class AssignmentsRepository {
  async list(page: number, pageSize: number): Promise<{ rows: AssignmentRow[]; total: number }> {
    // 软删作业不展示
    const where = isNull(assignments.deletedAt);
    const rows = await db
      .select()
      .from(assignments)
      .where(where)
      .orderBy(desc(assignments.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(assignments).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  // 软删作业视为不存在（详情/提交/下载/查看提交统一 404）；回收站走 findWithDeletedById
  async findById(id: string): Promise<AssignmentRow | null> {
    const rows = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.id, id), isNull(assignments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async slugExists(slug: string): Promise<boolean> {
    const rows = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  async findBySlug(slug: string): Promise<AssignmentRow | null> {
    const rows = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.slug, slug), isNull(assignments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdOrSlug(value: string): Promise<AssignmentRow | null> {
    return isUuid(value) ? this.findById(value) : this.findBySlug(value);
  }

  async insert(row: {
    title: string;
    slug: string;
    description: string;
    publisherId: string;
    startAt: Date;
    deadlineAt: Date;
  }): Promise<AssignmentRow> {
    const inserted = await db.insert(assignments).values(row).returning();
    return inserted[0];
  }

  async update(
    id: string,
    patch: {
      title?: string;
      description?: string;
      startAt?: Date;
      deadlineAt?: Date;
    },
  ): Promise<AssignmentRow | null> {
    const rows = await db.update(assignments).set(patch).where(eq(assignments.id, id)).returning();
    return rows[0] ?? null;
  }

  async findMySubmissions(
    assignmentIds: string[],
    submitterId: string,
  ): Promise<SubmissionRow[]> {
    if (assignmentIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(assignmentSubmissions)
      .where(
        and(
          inArray(assignmentSubmissions.assignmentId, assignmentIds),
          eq(assignmentSubmissions.submitterId, submitterId),
        ),
      );
  }

  async findSubmission(assignmentId: string, submitterId: string, connection: typeof db | DatabaseTransaction = db): Promise<SubmissionRow | null> {
    const rows = await connection
      .select()
      .from(assignmentSubmissions)
      .where(
        and(
          eq(assignmentSubmissions.assignmentId, assignmentId),
          eq(assignmentSubmissions.submitterId, submitterId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findSubmissionByAttachmentId(attachmentId: string): Promise<SubmissionRow | null> {
    const rows = await db.select().from(assignmentSubmissions)
      .where(eq(assignmentSubmissions.attachmentId, attachmentId)).limit(1);
    return rows[0] ?? null;
  }

  // 管理端文件管理：批量查被作业提交占用的附件 id
  async listUsedAttachmentIds(attachmentIds: string[]): Promise<Set<string>> {
    if (attachmentIds.length === 0) {
      return new Set();
    }
    const rows = await db
      .select({ attachmentId: assignmentSubmissions.attachmentId })
      .from(assignmentSubmissions)
      .where(inArray(assignmentSubmissions.attachmentId, attachmentIds));
    return new Set(rows.map((row) => row.attachmentId));
  }

  async withSubmissionLock<T>(assignmentId: string, submitterId: string, operation: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`submission:${assignmentId}:${submitterId}`}, 0))`);
      return operation(tx);
    });
  }

  // 重复提交：按 (assignment_id, submitter_id) 覆盖旧提交，保留 created_at、刷新 updated_at
  async upsertSubmission(row: {
    assignmentId: string;
    submitterId: string;
    note: string | null;
    attachmentId: string;
  }, connection: typeof db | DatabaseTransaction = db): Promise<SubmissionRow> {
    const inserted = await connection
      .insert(assignmentSubmissions)
      .values(row)
      .onConflictDoUpdate({
        target: [assignmentSubmissions.assignmentId, assignmentSubmissions.submitterId],
        set: {
          note: row.note,
          attachmentId: row.attachmentId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return inserted[0];
  }

  async listSubmissions(
    assignmentId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const where = eq(assignmentSubmissions.assignmentId, assignmentId);
    const rows = await db
      .select()
      .from(assignmentSubmissions)
      .where(where)
      .orderBy(desc(assignmentSubmissions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assignmentSubmissions)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  // 我的提交：仅本人数据，按 updatedAt 倒序；软删作业的提交一并隐藏（恢复后回来）
  async listBySubmitter(
    submitterId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const where = and(
      eq(assignmentSubmissions.submitterId, submitterId),
      // 子查询过滤软删作业（无多态 FK 语义，显式排除）
      inArray(
        assignmentSubmissions.assignmentId,
        db.select({ id: assignments.id }).from(assignments).where(isNull(assignments.deletedAt)),
      ),
    );
    const rows = await db
      .select()
      .from(assignmentSubmissions)
      .where(where)
      .orderBy(desc(assignmentSubmissions.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assignmentSubmissions)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async findByIds(ids: string[]): Promise<AssignmentRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select()
      .from(assignments)
      .where(and(inArray(assignments.id, ids), isNull(assignments.deletedAt)));
  }

  // ===== 作业软删除 / 回收站 =====

  // 软删除：置 deleted_at（提交经 FK 保留，随作业一并隐藏、恢复一并回来）
  async softDeleteAssignment(id: string): Promise<AssignmentRow | null> {
    const rows = await db
      .update(assignments)
      .set({ deletedAt: new Date() })
      .where(and(eq(assignments.id, id), isNull(assignments.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  // 恢复用：含软删行（未删行命中时由 service 判 409）
  async findWithDeletedById(id: string): Promise<AssignmentRow | null> {
    const rows = await db.select().from(assignments).where(eq(assignments.id, id)).limit(1);
    return rows[0] ?? null;
  }

  // 回收站：仅软删行，deleted_at desc
  async listDeletedAssignments(
    page: number,
    pageSize: number,
  ): Promise<{ rows: AssignmentRow[]; total: number }> {
    const where = isNotNull(assignments.deletedAt);
    const rows = await db
      .select()
      .from(assignments)
      .where(where)
      .orderBy(desc(assignments.deletedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(assignments).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async restoreAssignment(id: string): Promise<AssignmentRow | null> {
    const rows = await db
      .update(assignments)
      .set({ deletedAt: null })
      .where(and(eq(assignments.id, id), isNotNull(assignments.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
