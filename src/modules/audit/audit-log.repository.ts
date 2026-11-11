import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { auditLogs } from '../../db/schema';

export type AuditLogRow = typeof auditLogs.$inferSelect;

@Injectable()
export class AuditLogRepository {
  async insert(row: {
    actorId: string;
    actorEmail: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    detail: Record<string, unknown> | null;
  }): Promise<void> {
    await db.insert(auditLogs).values(row);
  }

  async list(params: {
    action?: string;
    targetType?: string;
    actorId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: AuditLogRow[]; total: number }> {
    const conditions = [];
    if (params.action) {
      conditions.push(eq(auditLogs.action, params.action));
    }
    if (params.targetType) {
      conditions.push(eq(auditLogs.targetType, params.targetType));
    }
    if (params.actorId) {
      conditions.push(eq(auditLogs.actorId, params.actorId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }
}
