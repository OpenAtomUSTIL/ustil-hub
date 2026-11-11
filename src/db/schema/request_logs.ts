import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

// 请求日志（Gin 式访问日志）：user_id / user_email 为快照，不加 FK，账号删除后日志保留
export const requestLogs = pgTable(
  'request_logs',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    method: text('method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code').notNull(),
    userId: uuid('user_id'),
    userEmail: text('user_email'),
    ip: text('ip').notNull(),
    userAgent: text('user_agent').notNull(),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('request_logs_created_at_idx').on(t.createdAt),
    index('request_logs_user_id_idx').on(t.userId),
    index('request_logs_method_idx').on(t.method),
  ],
);
