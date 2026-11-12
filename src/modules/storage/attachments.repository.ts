import { Injectable } from '@nestjs/common';
import { desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db, Database } from '../../db';
import { attachments } from '../../db/schema';

export type AttachmentRow = typeof attachments.$inferSelect;

@Injectable()
export class AttachmentsRepository {
  /** 仅暴露文件盘点所需字段，供后台在数据库内组合分页。 */
  adminFileSource(connection: Pick<Database, 'select'>, keyword?: string) {
    const trimmed = keyword?.trim();
    return connection.select({
      kind: sql<'ATTACHMENT' | 'AVATAR'>`'ATTACHMENT'::text`.as('kind'),
      id: attachments.id,
      key: attachments.key,
      fileName: sql<string>`${attachments.originalName}`.as('file_name'),
      size: attachments.size,
      uploaderId: attachments.uploaderId,
      email: sql<string | null>`null::text`.as('email'),
      createdAt: attachments.createdAt,
    }).from(attachments)
      .where(trimmed ? ilike(attachments.originalName, `%${trimmed}%`) : undefined);
  }

  async insert(row: {
    key: string;
    originalName: string;
    size: number;
    mime: string;
    uploaderId: string;
  }): Promise<AttachmentRow> {
    const inserted = await db.insert(attachments).values(row).returning();
    return inserted[0];
  }

  async findById(id: string): Promise<AttachmentRow | null> {
    const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByKey(key: string): Promise<AttachmentRow | null> {
    const rows = await db.select().from(attachments).where(eq(attachments.key, key)).limit(1);
    return rows[0] ?? null;
  }

  async findByIds(ids: string[]): Promise<AttachmentRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return db.select().from(attachments).where(inArray(attachments.id, ids));
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(attachments).where(eq(attachments.id, id));
  }

  async listForAdmin(params: {
    keyword?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: AttachmentRow[]; total: number }> {
    const trimmed = params.keyword?.trim();
    const where = trimmed ? ilike(attachments.originalName, `%${trimmed}%`) : undefined;
    const rows = await db
      .select()
      .from(attachments)
      .where(where)
      .orderBy(desc(attachments.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(attachments).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  // 合并分页用：取 createdAt desc 的前 limit 行与总数
  async listWindowForAdmin(params: {
    keyword?: string;
    limit: number;
  }): Promise<{ rows: AttachmentRow[]; total: number }> {
    const trimmed = params.keyword?.trim();
    const where = trimmed ? ilike(attachments.originalName, `%${trimmed}%`) : undefined;
    const rows = await db
      .select()
      .from(attachments)
      .where(where)
      .orderBy(desc(attachments.createdAt))
      .limit(params.limit);
    const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(attachments).where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }
}
