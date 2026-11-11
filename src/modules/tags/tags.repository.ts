import { Injectable } from '@nestjs/common';
import { asc, desc, eq, inArray, sql, and, isNull, or } from 'drizzle-orm';
import { db } from '../../db';
import { TagTargetType, articles, issues, resources, taggings, tags } from '../../db/schema';

export type TagRow = typeof tags.$inferSelect;

@Injectable()
export class TagsRepository {
  async listWithCounts(): Promise<{ id: string; name: string; count: number }[]> {
    // 计数排除软删目标（文章/资源 deleted_at 非空不计；issue 恒有效）
    const aliveCond = or(
      and(eq(taggings.targetType, 'ARTICLE'), isNull(articles.deletedAt)),
      eq(taggings.targetType, 'ISSUE'),
      and(eq(taggings.targetType, 'RESOURCE'), isNull(resources.deletedAt)),
    );
    const aliveCount = sql<number>`count(${taggings.id}) filter (where ${aliveCond})::int`;
    return db
      .select({
        id: tags.id,
        name: tags.name,
        count: aliveCount,
      })
      .from(tags)
      .leftJoin(taggings, eq(taggings.tagId, tags.id))
      .leftJoin(articles, and(eq(taggings.targetType, 'ARTICLE'), eq(articles.id, taggings.targetId)))
      .leftJoin(resources, and(eq(taggings.targetType, 'RESOURCE'), eq(resources.id, taggings.targetId)))
      .groupBy(tags.id)
      .orderBy(desc(aliveCount), asc(tags.name));
  }

  async findTargetIds(targetType: TagTargetType, name: string): Promise<string[]> {
    const rows = await db
      .select({ targetId: taggings.targetId })
      .from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(and(eq(taggings.targetType, targetType), eq(tags.name, name)));
    return rows.map((row) => row.targetId);
  }

  async findNamesByTargets(
    targetType: TagTargetType,
    targetIds: string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (targetIds.length === 0) {
      return map;
    }
    const rows = await db
      .select({ targetId: taggings.targetId, name: tags.name })
      .from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(and(eq(taggings.targetType, targetType), inArray(taggings.targetId, targetIds)))
      .orderBy(asc(tags.name));
    for (const row of rows) {
      const list = map.get(row.targetId) ?? [];
      list.push(row.name);
      map.set(row.targetId, list);
    }
    return map;
  }

  // 覆盖目标的标签引用：补建缺失标签 → 清旧引用 → 写新引用（names 必须已规范化小写去重）
  async syncTaggings(targetType: TagTargetType, targetId: string, names: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const name of names) {
        await tx.insert(tags).values({ name }).onConflictDoNothing({ target: tags.name });
      }
      await tx
        .delete(taggings)
        .where(and(eq(taggings.targetType, targetType), eq(taggings.targetId, targetId)));
      if (names.length > 0) {
        const tagRows = await tx.select().from(tags).where(inArray(tags.name, names));
        await tx.insert(taggings).values(
          tagRows.map((tag) => ({
            tagId: tag.id,
            targetType,
            targetId,
          })),
        );
      }
    });
  }

  async deleteTaggings(targetType: TagTargetType, targetId: string): Promise<void> {
    await db
      .delete(taggings)
      .where(and(eq(taggings.targetType, targetType), eq(taggings.targetId, targetId)));
  }

  // 剔除学员级联删除其 issues 时，同步清理对应 taggings（无多态 FK，必须显式清理）。
  // 这里对 issues 表的引用只是删除条件的关联子查询，写入/删除对象均为 taggings 自身。
  async deleteIssueTaggingsOfAuthor(authorId: string): Promise<void> {
    await db
      .delete(taggings)
      .where(
        and(
          eq(taggings.targetType, 'ISSUE'),
          inArray(
            taggings.targetId,
            db.select({ id: issues.id }).from(issues).where(eq(issues.authorId, authorId)),
          ),
        ),
      );
  }
}
