import { index, pgTable, timestamp, uniqueIndex, uuid, text } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

/** 用户名变更历史：旧 handle 保留跳转（防外链失效），且不可被他人抢占 */
export const userUsernameHistory = pgTable(
  'user_username_history',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_username_history_username_key').on(t.username),
    index('user_username_history_user_id_idx').on(t.userId),
  ],
);
