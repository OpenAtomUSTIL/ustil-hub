import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { NotificationType, notifications } from '../../db/schema';

export type NotificationRow = typeof notifications.$inferSelect;

@Injectable()
export class NotificationsRepository {
  async insertMany(
    rows: {
      userId: string;
      type: NotificationType;
      title: string;
      body: string | null;
      link: string | null;
    }[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await db.insert(notifications).values(rows);
  }

  async listByUser(
    userId: string,
    params: { unreadOnly?: boolean; page: number; pageSize: number },
  ): Promise<{ rows: NotificationRow[]; total: number }> {
    const where = params.unreadOnly
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : eq(notifications.userId, userId);
    const rows = await db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(where);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return rows[0]?.count ?? 0;
  }

  async findById(id: string): Promise<NotificationRow | null> {
    const rows = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async markRead(id: string, readAt: Date): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
  }

  async markAllRead(userId: string, readAt: Date): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}
