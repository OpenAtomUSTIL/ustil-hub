import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const USERNAME_RE = /^[A-Za-z0-9_-]{2,32}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function shortRandom(len = 8): string {
  return randomUUID().replace(/-/g, '').slice(0, len);
}

/** 标题 → slug：保留中文与字母数字，其余折叠为 '-'；空结果返回 '' */
export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 昵称 → username：仅允许 2-32 位字母/数字/-/_，否则返回 null */
export function slugifyUsername(nickname: string): string | null {
  const t = nickname.trim().toLowerCase();
  return USERNAME_RE.test(t) ? t : null;
}

// 与前端固定页面、后端审核队列以及 UUID 查询分支保持互斥。
const RESERVED_CONTENT_SLUGS = new Set(['new', 'pending']);

/** 生成全局唯一 slug（冲突追加 -2/-3…，仍冲突则随机后缀） */
export async function uniqueSlug(
  title: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyTitle(title) || shortRandom();
  if (!RESERVED_CONTENT_SLUGS.has(base) && !isUuid(base) && !(await exists(base))) return base;
  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${shortRandom(6)}`;
}

/** 生成全局唯一 username（昵称不合规则回退 user-xxxxxxx） */
export async function uniqueUsername(
  nickname: string,
  exists: (username: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyUsername(nickname) ?? `user-${shortRandom()}`;
  if (!(await exists(base))) return base;
  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base.slice(0, 26)}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base.slice(0, 25)}-${shortRandom(6)}`;
}

/** 短链接查重不是锁：插入撞名时重新分配，仅重试 slug 唯一约束。 */
export async function insertWithUniqueSlug<T>(
  title: string,
  exists: (slug: string) => Promise<boolean>,
  insert: (slug: string) => Promise<T>,
): Promise<T> {
  const collided = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = await uniqueSlug(title, async (value) => collided.has(value) || await exists(value));
    try {
      return await insert(slug);
    } catch (error) {
      const outer = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
      const pg = outer?.cause ?? outer;
      if (pg?.code !== '23505' || !/^(articles|issues|resources|announcements|assignments)_slug_key$/.test(pg.constraint ?? '')) {
        throw error;
      }
      collided.add(slug);
    }
  }
  throw new ConflictException('同名内容正在创建，请稍后重试');
}
