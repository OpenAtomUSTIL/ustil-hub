import { UserPublic } from '../users/users.views';

export interface ArticleListItem {
  id: string;
  slug: string;
  title: string;
  /** 根据当前完整正文估算，正整数分钟。 */
  readingMinutes: number;
  excerpt: string;
  tags: string[];
  author: UserPublic;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleDetail {
  id: string;
  slug: string;
  title: string;
  /** 根据当前完整正文估算，正整数分钟。 */
  readingMinutes: number;
  content: string;
  tags: string[];
  author: UserPublic;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}
