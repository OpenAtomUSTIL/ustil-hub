import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

// 审计日志：actor_email 为操作时刻快照，不加 FK，账号删除后日志保留
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    actorId: uuid('actor_id').notNull(),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_at_idx').on(t.createdAt),
    index('audit_logs_actor_id_idx').on(t.actorId),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
  ],
);
