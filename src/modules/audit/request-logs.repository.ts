import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { requestLogs } from '../../db/schema';

export type RequestLogRow = typeof requestLogs.$inferSelect;

@Injectable()
export class RequestLogsRepository {
  async insert(row: {
    method: string;
    path: string;
    statusCode: number;
    userId: string | null;
    userEmail: string | null;
    ip: string;
    userAgent: string;
    durationMs: number;
  }): Promise<void> {
    await db.insert(requestLogs).values(row);
  }

  async list(params: {
    userId?: string;
    method?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: RequestLogRow[]; total: number }> {
    const conditions = [];
    if (params.userId) {
      conditions.push(eq(requestLogs.userId, params.userId));
    }
    if (params.method) {
      conditions.push(eq(requestLogs.method, params.method));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(requestLogs)
      .where(where)
      .orderBy(desc(requestLogs.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(requestLogs)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }
}
