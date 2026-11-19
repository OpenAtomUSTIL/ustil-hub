import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    title: text('title').notNull(),
    // URL 用 slug（不暴露裸 id）：创建时由标题生成，创建后不变
    slug: text('slug').notNull(),
    description: text('description').notNull(),
    publisherId: uuid('publisher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    // 业务软删除（WHEEL/ADMIN 删作业）：置 deleted_at 进回收站可恢复，不连带删提交；FK 级联仍为硬删
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('assignments_publisher_id_idx').on(t.publisherId),
    index('assignments_start_at_idx').on(t.startAt),
    index('assignments_deadline_at_idx').on(t.deadlineAt),
    index('assignments_deleted_at_idx').on(t.deletedAt),
    uniqueIndex('assignments_slug_key').on(t.slug),
  ],
);
