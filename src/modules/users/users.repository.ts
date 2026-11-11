import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { UserStatus, users } from '../../db/schema';

export type UserRow = typeof users.$inferSelect;

@Injectable()
export class UsersRepository {
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
    await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }

  async updateStatus(id: string, status: UserStatus): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ status })
      .where(eq(users.id, id))
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

  async updateRole(id: string, role: UserRow['role']): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async deleteById(id: string): Promise<UserRow | null> {
    const rows = await db.delete(users).where(eq(users.id, id)).returning();
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
      .set({ role: 'ALUMNI' })
      .where(and(eq(users.role, 'MEMBER'), lt(users.createdAt, before)))
      .returning({ id: users.id });
    return rows.length;
  }

  async applyInviteCode(id: string, inviteCodeId: string): Promise<UserRow | null> {
    const rows = await db
      .update(users)
      .set({ role: 'MEMBER', inviteCodeId })
      .where(and(eq(users.id, id), eq(users.role, 'VISITOR')))
      .returning();
    return rows[0] ?? null;
  }
}
