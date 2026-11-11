import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

// 登录日志：user_id / email 为操作时刻快照，不加 FK，账号删除后日志保留。
// email 存登录标识（邮箱或手机号），失败记录亦可追溯。
export const loginLogs = pgTable(
  'login_logs',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id'),
    email: text('email').notNull(),
    ip: text('ip').notNull(),
    userAgent: text('user_agent'),
    success: boolean('success').notNull(),
    failReason: text('fail_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('login_logs_created_at_idx').on(t.createdAt),
    index('login_logs_email_idx').on(t.email),
  ],
);
