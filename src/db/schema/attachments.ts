import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    key: text('key').notNull(),
    originalName: text('original_name').notNull(),
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attachments_key_key').on(t.key),
    index('attachments_uploader_id_idx').on(t.uploaderId),
    index('attachments_created_at_id_idx').on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  ],
);
