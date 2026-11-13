import { Role } from '../../common/decorators/roles.decorator';
import { UserStatus } from '../../db/schema/users';

export interface UserSelf {
  id: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  email?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserPublic {
  id: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
}

export interface UserAuthRecord {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthUser {
  id: string;
  role: Role;
  status: UserStatus;
  sessionVersion: number;
  email: string | null;
}

/** 管理后台用户视图（联系方式脱敏） */
export interface AdminUserView {
  id: string;
  nickname: string;
  contact: string | null;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface AdminUserPage {
  items: AdminUserView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OnlineUserItem {
  userId: string;
  email: string | null;
  nickname: string;
  role: Role;
  lastSeenAt: string;
}

export interface OnlineUsersView {
  minutes: number;
  total: number;
  items: OnlineUserItem[];
}

/** 头像文件引用（管理端文件管理用） */
export interface AvatarFileRef {
  userId: string;
  email: string | null;
  nickname: string;
  key: string;
  updatedAt: Date;
}

/** 个人主页视图 */
export interface UserProfileView {
  id: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
  bio: string | null;
  profileReadme: string | null;
  createdAt: string;
  stats: {
    articles: number;
    issues: number;
    replies: number;
    submissions: number;
  };
  topTags: { name: string; count: number }[];
  pinnedItems: { type: string; id: string; slug: string; title: string; url?: string }[];
  isSelf: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  email?: string;
  phone?: string;
}

/** 关注/粉丝列表用户卡 */
export interface FollowUserView {
  id: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
  bio: string | null;
  isSelf: boolean;
  isFollowing: boolean;
}

/** 活跃热力图数据 */
export interface ActivityView {
  days: { date: string; count: number }[];
}

/** 个人主页 · 社区数据徽章（README 外链实时数据） */
export interface UserStatsBadgeView {
  articles: number;
  issues: number;
  replies: number;
  submissions: number;
  contributions: number;
  streak: number;
}

/** shields 风格单枚徽章 */
export interface StatsBadgeItem {
  label: string;
  message: string;
  color: string;
}

/** 个人主页 · 回复 Tab 列表项 */
export interface ProfileReplyView {
  id: string;
  issueId: string;
  issueSlug: string;
  issueTitle: string;
  content: string;
  createdAt: string;
}
