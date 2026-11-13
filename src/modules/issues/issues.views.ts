import { IssueStatus } from '../../db/schema';
import { UserPublic } from '../users/users.views';

export interface IssueListItem {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  status: IssueStatus;
  author: UserPublic;
  replyCount: number;
  answeredBy: UserPublic | null;
  answeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReplyView {
  id: string;
  content: string;
  author: UserPublic;
  createdAt: string;
}

export interface IssueDetail extends IssueListItem {
  content: string;
  replies: ReplyView[];
}

/** 管理端评论（讨论回复）视图，含软删标记 */
export interface CommentItem {
  id: string;
  issueId: string;
  issueTitle: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  deletedAt: string | null;
}

/** 回收站 COMMENT 条目的原始快照 */
export interface DeletedReplySnapshot {
  id: string;
  issueId: string;
  issueTitle: string;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}
