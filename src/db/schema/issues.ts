import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const issueStatusEnum = pgEnum('issue_status', ['OPEN', 'ANSWERED', 'ON_HOLD']);

export const IssueStatus = {
  OPEN: 'OPEN',
  ANSWERED: 'ANSWERED',
  ON_HOLD: 'ON_HOLD',
} as const;
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

export const issues = pgTable(
  'issues',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    title: text('title').notNull(),
    // URL 用 slug（不暴露裸 id）：创建时由标题生成，创建后不变
    slug: text('slug').notNull(),
    content: text('content').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: issueStatusEnum('status').notNull().default('OPEN'),
    answeredBy: uuid('answered_by').references(() => users.id, { onDelete: 'set null' }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('issues_author_id_idx').on(t.authorId),
    index('issues_status_idx').on(t.status),
    index('issues_created_at_idx').on(t.createdAt),
    uniqueIndex('issues_slug_key').on(t.slug),
  ],
);
