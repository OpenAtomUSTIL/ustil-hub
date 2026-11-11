import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../../db';
import { loginLogs } from '../../db/schema';

export type LoginLogRow = typeof loginLogs.$inferSelect;

@Injectable()
export class LoginLogsRepository {
  async insert(row: {
    userId: string | null;
    email: string;
    ip: string;
    userAgent: string | null;
    success: boolean;
    failReason: string | null;
  }): Promise<void> {
    await db.insert(loginLogs).values(row);
  }

  async list(params: {
    email?: string;
    success?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ rows: LoginLogRow[]; total: number }> {
    const conditions = [];
    if (params.email) {
      conditions.push(ilike(loginLogs.email, `%${params.email.trim()}%`));
    }
    if (params.success !== undefined) {
      conditions.push(eq(loginLogs.success, params.success));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(loginLogs)
      .where(where)
      .orderBy(desc(loginLogs.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(loginLogs).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }
}
