import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { inviteCodes } from './invite_codes';

export const userRoleEnum = pgEnum('user_role', ['ADMIN', 'ALUMNI', 'MEMBER', 'VISITOR', 'WHEEL']);
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'BANNED']);

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  BANNED: 'BANNED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    nickname: text('nickname').notNull(),
    // 主页地址用 handle（不暴露裸 id）：2-32 位字母/数字/-/_，注册时由昵称生成，可在设置中改
    username: text('username').notNull(),
    avatarUrl: text('avatar_url'),
    role: userRoleEnum('role').notNull().default('MEMBER'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    // 改密、登出、角色/封禁变更后递增，让已签发的 access/refresh 同时失效。
    sessionVersion: integer('session_version').notNull().default(0),
    // 注册时使用的邀请码（来源追溯，一个码对应多个用户）
    inviteCodeId: uuid('invite_code_id').references(() => inviteCodes.id, {
      onDelete: 'set null',
    }),
    // 最近活跃时间（在线用户统计用，请求拦截器节流更新）
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    // 个人主页：短 bio + 长 README + 置顶内容
    // v10.0 起 bio/profileReadme/company/location/link/email/phone/socials 存信封 token（长度校验在输入层）
    bio: text('bio'),
    profileReadme: text('profile_readme'),
    pinnedItems: jsonb('pinned_items').$type<{ type: string; id: string }[]>().default([]),
    // GitHub 式资料字段（v9.0）：公司/学校、所在地、个人链接、社交账户（公开可见）
    company: text('company'),
    location: text('location'),
    link: text('link'),
    socials: jsonb('socials').$type<string[]>().default([]),
    // 信封加密（v10.0）：用户标识（参与密钥派生、信封 keyId）+ 精确查找 HMAC 列
    cryptoId: varchar('crypto_id', { length: 32 }),
    emailHmac: varchar('email_hmac', { length: 64 }),
    phoneHmac: varchar('phone_hmac', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    // v10.0：email/phone 列存信封 token（随机 IV 恒唯一），唯一性约束迁到确定性 HMAC 查找列
    uniqueIndex('users_email_hmac_key').on(t.emailHmac),
    uniqueIndex('users_phone_hmac_key').on(t.phoneHmac),
    uniqueIndex('users_crypto_id_key').on(t.cryptoId),
    uniqueIndex('users_username_key').on(t.username),
    index('users_last_seen_at_idx').on(t.lastSeenAt),
    index('users_avatar_updated_at_id_idx').on(t.updatedAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.avatarUrl} like '/api/v1/storage/files/_%'`),
    index('users_role_idx').on(t.role),
    index('users_status_idx').on(t.status),
    index('users_invite_code_id_idx').on(t.inviteCodeId),
    // ADMIN 全局唯一（部分唯一索引，仅约束 role='ADMIN' 的行）
    uniqueIndex('users_admin_role_key')
      .on(t.role)
      .where(sql`role = 'ADMIN'`),
    check('users_email_or_phone_chk', sql`(email is not null or phone is not null)`),
  ],
);
