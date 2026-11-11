import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { issues } from './issues';
import { users } from './users';

export const issueReplies = pgTable(
  'issue_replies',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    // 软删除标记：非空即回收站中，普通查询排除；剔除学员/删 issue 的 FK 级联仍为硬删
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('issue_replies_issue_id_idx').on(t.issueId),
    index('issue_replies_author_id_idx').on(t.authorId),
    index('issue_replies_deleted_at_idx').on(t.deletedAt),
  ],
);
