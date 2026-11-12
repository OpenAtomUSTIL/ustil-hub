import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const articles = pgTable(
  'articles',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    title: text('title').notNull(),
    content: text('content').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // 审核状态：PENDING 待审 / PUBLISHED 已发布 / REJECTED 已拒绝 / HIDDEN 已隐藏
    status: text('status').notNull().default('PUBLISHED'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    // 软删除标记：非空即回收站中，普通查询排除；taggings 保留以便恢复
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('articles_author_id_idx').on(t.authorId),
    index('articles_created_at_idx').on(t.createdAt),
    index('articles_deleted_at_idx').on(t.deletedAt),
    index('articles_status_idx').on(t.status),
  ],
);
