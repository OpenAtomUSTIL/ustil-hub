import { Role } from '../../common/decorators/roles.decorator';
import { UserStatus } from '../../db/schema/users';

export interface UserSelf {
  id: string;
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
