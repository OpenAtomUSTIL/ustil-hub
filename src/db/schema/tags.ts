import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export const tagTargetTypeEnum = pgEnum('tag_target_type', ['ARTICLE', 'ISSUE', 'RESOURCE']);

export const TagTargetType = {
  ARTICLE: 'ARTICLE',
  ISSUE: 'ISSUE',
  RESOURCE: 'RESOURCE',
} as const;
export type TagTargetType = (typeof TagTargetType)[keyof typeof TagTargetType];

export const tags = pgTable(
  'tags',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    // 标签名统一小写存储，保证大小写不敏感去重与精确匹配
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_name_key').on(t.name)],
);

// 无多态外键：目标删除时由 service 层显式清理
export const taggings = pgTable(
  'taggings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    targetType: tagTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('taggings_tag_target_key').on(t.tagId, t.targetType, t.targetId),
    index('taggings_target_idx').on(t.targetType, t.targetId),
    index('taggings_tag_id_idx').on(t.tagId),
  ],
);
