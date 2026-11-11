import { Injectable, Logger } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogRepository } from './audit-log.repository';

export interface AuditLogInput {
  actor: CurrentAuthUser;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
}

/** 审计写入：供各模块调用；写库失败只告警不打断业务 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly auditLogRepository: AuditLogRepository) {}

  async record(input: AuditLogInput): Promise<void> {
    try {
      await this.auditLogRepository.insert({
        actorId: input.actor.id,
        actorEmail: input.actor.email ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        detail: input.detail ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `audit log write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
