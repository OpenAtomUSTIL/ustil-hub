import { Injectable } from '@nestjs/common';
import { type SQL, and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { ResourceCategory, resources } from '../../db/schema';

export type ResourceRow = typeof resources.$inferSelect;

@Injectable()
export class ResourcesRepository {
  async list(
    page: number,
    pageSize: number,
    filters: {
      category?: ResourceCategory;
      keyword?: string;
      creatorId?: string;
      tagTargetIds?: string[];
    },
  ): Promise<{ rows: ResourceRow[]; total: number }> {
    // 普通查询一律排除软删行
    const conditions: (SQL | undefined)[] = [isNull(resources.deletedAt)];
    if (filters.category) {
      conditions.push(eq(resources.category, filters.category));
    }
    if (filters.creatorId) {
      conditions.push(eq(resources.creatorId, filters.creatorId));
    }
    const trimmed = filters.keyword?.trim();
    if (trimmed) {
      const pattern = `%${trimmed}%`;
      conditions.push(or(ilike(resources.title, pattern), ilike(resources.description, pattern)));
    }
    if (filters.tagTargetIds) {
      if (filters.tagTargetIds.length === 0) {
        return { rows: [], total: 0 };
      }
      conditions.push(inArray(resources.id, filters.tagTargetIds));
    }
    const where = and(...conditions);
    const rows = await db
      .select()
      .from(resources)
      .where(where)
      .orderBy(desc(resources.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(resources)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async findById(id: string): Promise<ResourceRow | null> {
    const rows = await db
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), isNull(resources.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdIncludingDeleted(id: string): Promise<ResourceRow | null> {
    const rows = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async insert(row: {
    title: string;
    description: string | null;
    url: string;
    category: ResourceCategory;
    creatorId: string;
  }): Promise<ResourceRow> {
    const inserted = await db.insert(resources).values(row).returning();
    return inserted[0];
  }

  async update(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      url?: string;
      category?: ResourceCategory;
    },
  ): Promise<ResourceRow | null> {
    const rows = await db.update(resources).set(patch).where(eq(resources.id, id)).returning();
    return rows[0] ?? null;
  }

  // 软删除：置 deleted_at；taggings 保留，恢复后完整可见
  async softDeleteById(id: string): Promise<ResourceRow | null> {
    const rows = await db
      .update(resources)
      .set({ deletedAt: new Date() })
      .where(and(eq(resources.id, id), isNull(resources.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  // 回收站：deleted_at desc
  async listDeleted(
    page: number,
    pageSize: number,
  ): Promise<{ rows: ResourceRow[]; total: number }> {
    const where = isNotNull(resources.deletedAt);
    const rows = await db
      .select()
      .from(resources)
      .where(where)
      .orderBy(desc(resources.deletedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(resources)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async restoreById(id: string): Promise<ResourceRow | null> {
    const rows = await db
      .update(resources)
      .set({ deletedAt: null })
      .where(and(eq(resources.id, id), isNotNull(resources.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
