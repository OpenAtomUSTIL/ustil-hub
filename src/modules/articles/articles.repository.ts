import { Injectable } from '@nestjs/common';
import { type SQL, and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { articles } from '../../db/schema';

export type ArticleRow = typeof articles.$inferSelect;

@Injectable()
export class ArticlesRepository {
  private buildWhere(keyword?: string, authorId?: string, tagTargetIds?: string[]) {
    // 普通查询一律排除软删行
    const conditions: (SQL | undefined)[] = [isNull(articles.deletedAt)];
    const trimmed = keyword?.trim();
    if (trimmed) {
      const pattern = `%${trimmed}%`;
      conditions.push(or(ilike(articles.title, pattern), ilike(articles.content, pattern)));
    }
    if (authorId) {
      conditions.push(eq(articles.authorId, authorId));
    }
    if (tagTargetIds) {
      if (tagTargetIds.length === 0) {
        return { empty: true as const };
      }
      conditions.push(inArray(articles.id, tagTargetIds));
    }
    return { empty: false as const, where: and(...conditions) };
  }

  async list(
    page: number,
    pageSize: number,
    filters: {
      keyword?: string;
      authorId?: string;
      tagTargetIds?: string[];
    },
  ): Promise<{ rows: ArticleRow[]; total: number }> {
    const built = this.buildWhere(filters.keyword, filters.authorId, filters.tagTargetIds);
    if (built.empty) {
      return { rows: [], total: 0 };
    }
    const rows = await db
      .select()
      .from(articles)
      .where(built.where)
      .orderBy(desc(articles.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(built.where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async findById(id: string): Promise<ArticleRow | null> {
    const rows = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, id), isNull(articles.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdIncludingDeleted(id: string): Promise<ArticleRow | null> {
    const rows = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async insert(row: { title: string; content: string; authorId: string }): Promise<ArticleRow> {
    const inserted = await db.insert(articles).values(row).returning();
    return inserted[0];
  }

  async update(
    id: string,
    patch: { title?: string; content?: string },
  ): Promise<ArticleRow | null> {
    const rows = await db
      .update(articles)
      .set(patch)
      .where(eq(articles.id, id))
      .returning();
    return rows[0] ?? null;
  }

  // 软删除：置 deleted_at；taggings 保留，恢复后完整可见
  async softDeleteById(id: string): Promise<ArticleRow | null> {
    const rows = await db
      .update(articles)
      .set({ deletedAt: new Date() })
      .where(and(eq(articles.id, id), isNull(articles.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  // 回收站：deleted_at desc
  async listDeleted(
    page: number,
    pageSize: number,
  ): Promise<{ rows: ArticleRow[]; total: number }> {
    const where = isNotNull(articles.deletedAt);
    const rows = await db
      .select()
      .from(articles)
      .where(where)
      .orderBy(desc(articles.deletedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(articles).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async restoreById(id: string): Promise<ArticleRow | null> {
    const rows = await db
      .update(articles)
      .set({ deletedAt: null })
      .where(and(eq(articles.id, id), isNotNull(articles.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
