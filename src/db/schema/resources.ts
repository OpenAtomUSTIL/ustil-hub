import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './users';

export const resourceCategoryEnum = pgEnum('resource_category', [
  'GITHUB',
  'EXAM',
  'EBOOK',
  'DOCUMENT',
  'OTHER',
]);

export const ResourceCategory = {
  GITHUB: 'GITHUB',
  EXAM: 'EXAM',
  EBOOK: 'EBOOK',
  DOCUMENT: 'DOCUMENT',
  OTHER: 'OTHER',
} as const;
export type ResourceCategory = (typeof ResourceCategory)[keyof typeof ResourceCategory];

export const resources = pgTable(
  'resources',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    title: text('title').notNull(),
    // URL 用 slug（不暴露裸 id）：创建时由标题生成，创建后不变；软删不回收
    slug: text('slug').notNull(),
    description: text('description'),
    url: text('url').notNull(),
    category: resourceCategoryEnum('category').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // 软删除标记：非空即回收站中，普通查询排除；taggings 保留以便恢复
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('resources_creator_id_idx').on(t.creatorId),
    index('resources_category_idx').on(t.category),
    index('resources_created_at_idx').on(t.createdAt),
    index('resources_deleted_at_idx').on(t.deletedAt),
    uniqueIndex('resources_slug_key').on(t.slug),
  ],
);
