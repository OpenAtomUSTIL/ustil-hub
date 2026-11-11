export interface RequestLogItem {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  userId: string | null;
  userEmail: string | null;
  ip: string;
  durationMs: number;
  createdAt: string;
}

export interface AuditLogItem {
  id: string;
  actorId: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface LoginLogItem {
  id: string;
  userId: string | null;
  /** 登录标识快照（邮箱或手机号） */
  email: string;
  ip: string;
  userAgent: string | null;
  success: boolean;
  failReason: string | null;
  createdAt: string;
}
