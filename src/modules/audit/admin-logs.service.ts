import { Injectable } from '@nestjs/common';
import { Page } from '../../common/dto/page';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { AuditLogRepository } from './audit-log.repository';
import { LoginLogsRepository } from './login-logs.repository';
import { RequestLogsRepository } from './request-logs.repository';
import { AuditLogItem, LoginLogItem, RequestLogItem } from './audit.views';

@Injectable()
export class AdminLogsService {
  constructor(
    private readonly requestLogsRepository: RequestLogsRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly loginLogsRepository: LoginLogsRepository,
  ) {}

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
    const { rows, total } = await this.requestLogsRepository.list(query);
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
    const { rows, total } = await this.auditLogRepository.list(query);
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
