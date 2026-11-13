import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const userFollows = pgTable(
  'user_follows',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_follows_follower_followee_key').on(t.followerId, t.followeeId),
    index('user_follows_followee_id_idx').on(t.followeeId),
    index('user_follows_follower_id_idx').on(t.followerId),
  ],
);
