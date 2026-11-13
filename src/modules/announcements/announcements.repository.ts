import { Injectable } from '@nestjs/common';
import { type SQL, and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { announcements } from '../../db/schema';
import { isUuid } from '../../common/utils/identifiers';

export type AnnouncementRow = typeof announcements.$inferSelect;

@Injectable()
export class AnnouncementsRepository {
  private buildWhere(keyword?: string) {
    // 普通查询一律排除软删行
    const conditions: (SQL | undefined)[] = [isNull(announcements.deletedAt)];
    const trimmed = keyword?.trim();
    if (trimmed) {
      const pattern = `%${trimmed}%`;
      conditions.push(or(ilike(announcements.title, pattern), ilike(announcements.content, pattern)));
    }
    return and(...conditions);
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
  ): Promise<{ rows: AnnouncementRow[]; total: number }> {
    const where = this.buildWhere(keyword);
    const rows = await db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(announcements)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async findById(id: string): Promise<AnnouncementRow | null> {
    const rows = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), isNull(announcements.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdIncludingDeleted(id: string): Promise<AnnouncementRow | null> {
    const rows = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    return rows[0] ?? null;
  }

  // slug 唯一性检查需覆盖软删行（唯一约束跨软删生效）
  async slugExists(slug: string): Promise<boolean> {
    const rows = await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(eq(announcements.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  async findBySlug(slug: string): Promise<AnnouncementRow | null> {
    const rows = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.slug, slug), isNull(announcements.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdOrSlug(value: string): Promise<AnnouncementRow | null> {
    return isUuid(value) ? this.findById(value) : this.findBySlug(value);
  }

  async insert(row: {
    title: string;
    slug: string;
    content: string;
    pinned: boolean;
    authorId: string;
  }): Promise<AnnouncementRow> {
    const inserted = await db.insert(announcements).values(row).returning();
    return inserted[0];
  }

  async update(
    id: string,
    patch: { title?: string; content?: string; pinned?: boolean },
  ): Promise<AnnouncementRow | null> {
    const rows = await db.update(announcements).set(patch).where(eq(announcements.id, id)).returning();
    return rows[0] ?? null;
  }

  // 软删除：置 deleted_at
  async softDeleteById(id: string): Promise<AnnouncementRow | null> {
    const rows = await db
      .update(announcements)
      .set({ deletedAt: new Date() })
      .where(and(eq(announcements.id, id), isNull(announcements.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  // 回收站：deleted_at desc
  async listDeleted(
    page: number,
    pageSize: number,
  ): Promise<{ rows: AnnouncementRow[]; total: number }> {
    const where = isNotNull(announcements.deletedAt);
    const rows = await db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(desc(announcements.deletedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(announcements)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async restoreById(id: string): Promise<AnnouncementRow | null> {
    const rows = await db
      .update(announcements)
      .set({ deletedAt: null })
      .where(and(eq(announcements.id, id), isNotNull(announcements.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
