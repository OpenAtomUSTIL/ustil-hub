import { UserPublic } from '../users/users.views';

export interface ArticleListItem {
  id: string;
  slug: string;
  title: string;
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
  content: string;
  tags: string[];
  author: UserPublic;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}
