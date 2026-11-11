import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    title: text('title').notNull(),
    content: text('content').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // 软删除标记：非空即回收站中，普通查询排除
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('announcements_author_id_idx').on(t.authorId),
    index('announcements_created_at_idx').on(t.createdAt),
    index('announcements_pinned_idx').on(t.pinned),
    index('announcements_deleted_at_idx').on(t.deletedAt),
  ],
);
