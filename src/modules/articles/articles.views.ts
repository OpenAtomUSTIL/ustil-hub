import { UserPublic } from '../users/users.views';

export interface ArticleListItem {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  author: UserPublic;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleDetail {
  id: string;
  title: string;
  content: string;
  tags: string[];
  author: UserPublic;
  createdAt: string;
  updatedAt: string;
}
