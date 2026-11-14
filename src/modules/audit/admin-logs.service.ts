import { Injectable } from '@nestjs/common';
import { Page } from '../../common/dto/page';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { AuditLogRepository } from './audit-log.repository';
import { LoginLogsRepository } from './login-logs.repository';
import { RequestLogsRepository } from './request-logs.repository';
import { UsersService } from '../users/users.service';
import { AuditLogItem, LoginLogItem, RequestLogItem } from './audit.views';

@Injectable()
export class AdminLogsService {
  constructor(
    private readonly requestLogsRepository: RequestLogsRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly loginLogsRepository: LoginLogsRepository,
    private readonly usersService: UsersService,
  ) {}

  /** 解析式寻址（v6.0）：uuid / 用户名 / 邮箱 / 手机号 → userId；未命中返回 null（过滤语义→空列表） */
  private async resolveUserId(identifier: string | undefined): Promise<string | null | undefined> {
    if (!identifier) return undefined;
    const row = await this.usersService.resolveRowByIdentifier(identifier);
    return row ? row.id : null;
  }

  async listRequestLogs(
    query: {
      userId?: string;
      method?: string;
      page: number;
      pageSize: number;
    },
    actor: CurrentAuthUser,
  ): Promise<Page<RequestLogItem>> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const userId = await this.resolveUserId(query.userId);
    if (userId === null) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    const { rows, total } = await this.requestLogsRepository.list({ ...query, userId });
    return {
      items: rows.map((row) => ({
        id: row.id,
        method: row.method,
        path: row.path,
        statusCode: row.statusCode,
        userId: row.userId,
        userEmail: row.userEmail,
        ip: row.ip,
        durationMs: row.durationMs,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listAuditLogs(
    query: {
      action?: string;
      targetType?: string;
      actorId?: string;
      page: number;
      pageSize: number;
    },
    actor: CurrentAuthUser,
  ): Promise<Page<AuditLogItem>> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const actorId = await this.resolveUserId(query.actorId);
    if (actorId === null) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    const { rows, total } = await this.auditLogRepository.list({ ...query, actorId });
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        detail: (row.detail as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listLoginLogs(
    query: {
      email?: string;
      success?: boolean;
      page: number;
      pageSize: number;
    },
    actor: CurrentAuthUser,
  ): Promise<Page<LoginLogItem>> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const { rows, total } = await this.loginLogsRepository.list(query);
    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        email: row.email,
        ip: row.ip,
        userAgent: row.userAgent,
        success: row.success,
        failReason: row.failReason,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
