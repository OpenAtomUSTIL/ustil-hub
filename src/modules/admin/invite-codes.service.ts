import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { isISO8601 } from 'class-validator';
import { InviteCodeStatus } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { GenerateInviteCodesDto } from './dto/generate-invite-codes.dto';
import { ListInviteCodesDto } from './dto/list-invite-codes.dto';
import { InviteCodesRepository, InviteCodeRow } from './invite-codes.repository';
import { InviteCodePage, InviteCodeView } from './invite-codes.views';

// 去歧义 base32 字母表（无 0/O/1/I/L/U）
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 10;

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

@Injectable()
export class InviteCodesService {
  constructor(
    private readonly inviteCodesRepository: InviteCodesRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  private toView(row: InviteCodeRow): InviteCodeView {
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      maxUses: row.maxUses,
      usedCount: row.usedCount,
      remaining: row.maxUses - row.usedCount,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async generate(
    actor: CurrentAuthUser,
    dto: GenerateInviteCodesDto,
  ): Promise<{ items: InviteCodeView[] }> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    if (dto.expiresAt !== undefined && (!isISO8601(dto.expiresAt, { strict: true, strictSeparator: true }) || !dto.expiresAt.endsWith('Z'))) {
      throw new BadRequestException('expiresAt 必须是合法的 ISO 8601 UTC 时间');
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const codes = new Set<string>();
      while (codes.size < dto.count) {
        codes.add(generateCode());
      }
      try {
        const rows = await this.inviteCodesRepository.insertMany(
          [...codes].map((code) => ({
            code,
            maxUses: dto.maxUses,
            createdById: actor.id,
            expiresAt,
          })),
        );
        await this.auditLogService.record({
          actor,
          action: 'invite.create',
          targetType: 'INVITE_CODE',
          targetId: null,
          detail: { count: dto.count, maxUses: dto.maxUses },
        });
        return { items: rows.map((row) => this.toView(row)) };
      } catch (error) {
        // 码碰撞（概率极低）：整批重试
        if (!isUniqueViolation(error) || attempt === 2) {
          throw error;
        }
      }
    }
    throw new ConflictException('邀请码生成失败，请重试');
  }

  async list(dto: ListInviteCodesDto, actor: CurrentAuthUser): Promise<InviteCodePage> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const { rows, total } = await this.inviteCodesRepository.list({
      status: dto.status as InviteCodeStatus | undefined,
      page: dto.page,
      pageSize: dto.pageSize,
    });
    return {
      items: rows.map((row) => this.toView(row)),
      total,
      page: dto.page,
      pageSize: dto.pageSize,
    };
  }

  async revoke(id: string, actor: CurrentAuthUser): Promise<void> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const row = await this.inviteCodesRepository.revoke(id);
    if (!row) {
      throw new NotFoundException('邀请码不存在');
    }
    await this.auditLogService.record({
      actor,
      action: 'invite.revoke',
      targetType: 'INVITE_CODE',
      targetId: id,
      detail: { code: row.code },
    });
  }

  /** 注册核销：有效则原子 +1 并返回码 id；无效/作废/过期/用尽统一 409 */
  async consume(code: string): Promise<{ id: string }> {
    const normalized = code.trim().toUpperCase();
    const row = await this.inviteCodesRepository.findByCode(normalized);
    if (!row) {
      throw new ConflictException('邀请码无效');
    }
    if (row.status !== 'ACTIVE') {
      throw new ConflictException('邀请码已作废');
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('邀请码已过期');
    }
    const consumed = await this.inviteCodesRepository.tryConsume(row.id, new Date());
    if (!consumed) {
      throw new ConflictException('邀请码已被用尽');
    }
    return { id: row.id };
  }

  /** 核销补偿（注册落库失败时回退计数） */
  async release(id: string): Promise<void> {
    await this.inviteCodesRepository.release(id);
  }
}
