import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// 与删号同事务登记；存储服务故障或进程重启后仍可重试，不能依赖内存任务。
export const fileDeletions = pgTable('file_deletions', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
});
