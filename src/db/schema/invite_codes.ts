import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

export const inviteCodeStatusEnum = pgEnum('invite_code_status', ['ACTIVE', 'REVOKED']);

export const InviteCodeStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
} as const;
export type InviteCodeStatus = (typeof InviteCodeStatus)[keyof typeof InviteCodeStatus];

export const inviteCodes = pgTable(
  'invite_codes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    code: text('code').notNull(),
    status: inviteCodeStatusEnum('status').notNull().default('ACTIVE'),
    // 单码可被使用的人数上限（用尽 = usedCount >= maxUses）
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    // 生成人（WHEEL/ADMIN）；不加 FK 以避免与 users 的表定义循环引用，
    // 归属完整性由 service 层保证（只写入当前登录用户 id）
    createdById: uuid('created_by_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invite_codes_code_key').on(t.code),
    index('invite_codes_status_idx').on(t.status),
    index('invite_codes_created_by_id_idx').on(t.createdById),
    check('invite_codes_max_uses_chk', sql`max_uses >= 1 and max_uses <= 100`),
    check('invite_codes_used_count_chk', sql`used_count >= 0 and used_count <= max_uses`),
  ],
);
