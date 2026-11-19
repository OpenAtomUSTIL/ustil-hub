import { and, eq, ilike, or } from 'drizzle-orm';
import { db } from './index';
import { users } from './schema';

/**
 * 站内搜索作者扩展：关键词命中作者身份的用户 id 子查询。
 *
 * 口径同人员搜索（`GET /users`）：仅按**用户名 / 昵称**模糊匹配（v10.0：邮箱/手机号等
 * 密文字段不参与检索），排除封禁（`ACTIVE`）。内容列表 keyword 以 `OR` 并入本子查询：
 * 「标题/正文模糊匹配 或 作者命中」——搜用户名/昵称时该作者的内容一并命中。
 */
export function authorIdsMatchingKeyword(keyword: string) {
  const pattern = `%${keyword}%`;
  return db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.status, 'ACTIVE'),
        or(ilike(users.username, pattern), ilike(users.nickname, pattern)),
      ),
    );
}
