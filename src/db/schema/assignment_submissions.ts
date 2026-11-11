import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { assignments } from './assignments';
import { attachments } from './attachments';
import { users } from './users';

export const assignmentSubmissions = pgTable(
  'assignment_submissions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    submitterId: uuid('submitter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note'),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('assignment_submissions_assignment_submitter_key').on(t.assignmentId, t.submitterId),
    index('assignment_submissions_assignment_id_idx').on(t.assignmentId),
    index('assignment_submissions_submitter_id_idx').on(t.submitterId),
  ],
);
