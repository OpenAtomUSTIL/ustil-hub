import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const notificationTypeEnum = pgEnum('notification_type', [
  'ANNOUNCEMENT',
  'ASSIGNMENT',
  'ISSUE_REPLY',
  'ROLE',
  'SYSTEM',
]);

export const NotificationType = {
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  ASSIGNMENT: 'ASSIGNMENT',
  ISSUE_REPLY: 'ISSUE_REPLY',
  ROLE: 'ROLE',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_read_idx').on(t.userId, t.readAt),
  ],
);
