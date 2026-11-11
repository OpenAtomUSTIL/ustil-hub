import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { InviteCodeStatus, inviteCodes } from '../../db/schema';

export type InviteCodeRow = typeof inviteCodes.$inferSelect;

@Injectable()
export class InviteCodesRepository {
  async insertMany(
    rows: {
      code: string;
      maxUses: number;
      createdById: string;
      expiresAt: Date | null;
    }[],
  ): Promise<InviteCodeRow[]> {
    return db.insert(inviteCodes).values(rows).returning();
  }

  async findByCode(code: string): Promise<InviteCodeRow | null> {
    const rows = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<InviteCodeRow | null> {
    const rows = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(params: {
    status?: InviteCodeStatus;
    page: number;
    pageSize: number;
  }): Promise<{ rows: InviteCodeRow[]; total: number }> {
    const where = params.status ? eq(inviteCodes.status, params.status) : undefined;
    const rows = await db
      .select()
      .from(inviteCodes)
      .where(where)
      .orderBy(desc(inviteCodes.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inviteCodes)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  // 条件更新防超发：影响行数为 0 即已被用尽/作废/过期
  async tryConsume(id: string, now: Date): Promise<InviteCodeRow | null> {
    const rows = await db
      .update(inviteCodes)
      .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
      .where(
        and(
          eq(inviteCodes.id, id),
          eq(inviteCodes.status, 'ACTIVE'),
          lt(inviteCodes.usedCount, inviteCodes.maxUses),
          sql`(${inviteCodes.expiresAt} is null or ${inviteCodes.expiresAt} > ${now})`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  // 核销补偿（注册落库失败时回退计数）
  async release(id: string): Promise<void> {
    await db
      .update(inviteCodes)
      .set({ usedCount: sql`${inviteCodes.usedCount} - 1` })
      .where(and(eq(inviteCodes.id, id), sql`${inviteCodes.usedCount} > 0`));
  }

  async revoke(id: string): Promise<InviteCodeRow | null> {
    const rows = await db
      .update(inviteCodes)
      .set({ status: 'REVOKED' })
      .where(eq(inviteCodes.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async countActive(now: Date): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inviteCodes)
      .where(
        and(
          eq(inviteCodes.status, 'ACTIVE'),
          lt(inviteCodes.usedCount, inviteCodes.maxUses),
          sql`(${inviteCodes.expiresAt} is null or ${inviteCodes.expiresAt} > ${now})`,
        ),
      );
    return rows[0]?.count ?? 0;
  }
}
