import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { db } from '../../db';
import { AdminFilesRepository } from './admin-files.repository';
import { Page } from '../../common/dto/page';
import { requireRole } from '../../common/permissions';
import { AuditLogService } from '../audit/audit-log.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { AttachmentRow } from '../storage/attachments.repository';
import { UploadsService } from '../storage/uploads.service';
import { UsersService } from '../users/users.service';
import { AvatarFileRef } from '../users/users.views';
import { AdminFilesQueryDto } from './dto/admin-files-query.dto';
import { FileItem, FileKind } from './admin-files.views';

const AVATAR_ID_PREFIX = 'avatar:';
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

interface MergedEntry {
  kind: FileKind;
  id: string;
  fileName: string;
  createdAt: Date;
  attachment?: Pick<AttachmentRow, 'id' | 'key' | 'originalName' | 'size' | 'uploaderId' | 'createdAt'>;
  avatar?: Omit<AvatarFileRef, 'nickname'>;
}

/** 管理后台文件管理：附件 + 用户头像文件（合成 AVATAR 条目） */
@Injectable()
export class AdminFilesService {
  constructor(
    private readonly filesRepository: AdminFilesRepository,
    private readonly uploadsService: UploadsService,
    private readonly usersService: UsersService,
    private readonly assignmentsService: AssignmentsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private isImage(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXTS.has(ext);
  }

  async list(query: AdminFilesQueryDto, actor: CurrentAuthUser): Promise<Page<FileItem>> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const offset = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(offset + query.pageSize)) {
      throw new BadRequestException('分页范围过大');
    }
    // 同一快照读取列表和总数，不锁定写入；事务只覆盖数据库分页查询。
    const result = await db.transaction((tx) => this.filesRepository.list(tx, {
      attachment: this.uploadsService.adminFileSource(tx, query.keyword),
      avatar: this.usersService.adminFileSource(tx, query.keyword),
    }, { kind: query.kind, offset, pageSize: query.pageSize }), {
      isolationLevel: 'repeatable read', accessMode: 'read only',
    });
    const entries: MergedEntry[] = result.rows.map((row) => row.kind === 'ATTACHMENT' ? {
      kind: row.kind, id: row.id, fileName: row.fileName, createdAt: row.createdAt,
      attachment: {
        id: row.id, key: row.key, originalName: row.fileName, size: row.size,
        uploaderId: row.uploaderId, createdAt: row.createdAt,
      },
    } : {
      kind: row.kind, id: `${AVATAR_ID_PREFIX}${row.id}`,
      fileName: row.key, createdAt: row.createdAt,
      avatar: {
        userId: row.id, key: row.key, email: row.email, updatedAt: row.createdAt,
      },
    });

    const attachmentIds = entries
      .filter((entry) => entry.attachment)
      .map((entry) => (entry.attachment as AttachmentRow).id);
    const attachmentKeys = entries
      .filter((entry) => entry.attachment)
      .map((entry) => (entry.attachment as AttachmentRow).key);

    const [usedBySubmissions, referencedKeys, uploaderEmails, avatarSizes] = await Promise.all([
      this.assignmentsService.listUsedAttachmentIds(attachmentIds),
      this.usersService.findAvatarReferencedKeys(attachmentKeys),
      this.usersService.getEmailsByIds(
        entries
          .filter((entry) => entry.attachment)
          .map((entry) => (entry.attachment as AttachmentRow).uploaderId),
      ),
      Promise.all(
        entries
          .filter((entry) => entry.avatar)
          .map((entry) => this.uploadsService.statSize((entry.avatar as AvatarFileRef).key)),
      ),
    ]);
    const avatarSizeByKey = new Map<string, number>();
    let sizeIndex = 0;
    for (const entry of entries) {
      if (entry.avatar) {
        avatarSizeByKey.set(entry.avatar.key, avatarSizes[sizeIndex] ?? 0);
        sizeIndex += 1;
      }
    }

    const items = entries.map((entry): FileItem => {
      if (entry.attachment) {
        const row = entry.attachment;
        return {
          id: row.id,
          fileName: row.originalName,
          sizeBytes: row.size,
          kind: 'ATTACHMENT',
          uploaderId: row.uploaderId,
          uploaderEmail: uploaderEmails.get(row.uploaderId) ?? null,
          isImage: this.isImage(row.originalName),
          referenced: usedBySubmissions.has(row.id) || referencedKeys.has(row.key),
          createdAt: row.createdAt.toISOString(),
        };
      }
      const ref = entry.avatar as AvatarFileRef;
      return {
        id: entry.id,
        fileName: ref.key,
        sizeBytes: avatarSizeByKey.get(ref.key) ?? 0,
        kind: 'AVATAR',
        uploaderId: ref.userId,
        uploaderEmail: ref.email,
        isImage: this.isImage(ref.key),
        referenced: false,
        createdAt: entry.createdAt.toISOString(),
      };
    });

    return {
      items,
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async remove(id: string, actor: CurrentAuthUser): Promise<void> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    if (id.startsWith(AVATAR_ID_PREFIX)) {
      await this.removeAvatar(id.slice(AVATAR_ID_PREFIX.length), actor);
      return;
    }
    await this.removeAttachment(id, actor);
  }

  /** 头像供管理人员查看；作业附件仍须遵循提交归属权限。 */
  async resolveContent(
    id: string,
    actor: CurrentAuthUser,
  ): Promise<{ data: Buffer; contentType: string }> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    if (id.startsWith(AVATAR_ID_PREFIX)) {
      const userId = id.slice(AVATAR_ID_PREFIX.length);
      if (!isUuid(userId)) {
        throw new BadRequestException('ID 格式错误');
      }
      const ref = await this.usersService.getAvatarFileForAdmin(userId);
      if (!ref) {
        throw new NotFoundException('文件不存在');
      }
      return this.uploadsService.resolveFile(ref.key);
    }
    if (!isUuid(id)) {
      throw new BadRequestException('ID 格式错误');
    }
    const row = await this.uploadsService.getAttachmentRow(id);
    if (!row) {
      throw new NotFoundException('文件不存在');
    }
    if (actor.role === Role.ADMIN) return this.uploadsService.readAttachment(row.id);
    return this.assignmentsService.downloadAttachment(row.id, actor);
  }

  private async removeAvatar(userId: string, actor: CurrentAuthUser): Promise<void> {
    if (!isUuid(userId)) {
      throw new BadRequestException('ID 格式错误');
    }
    const removed = await this.usersService.deleteAvatarFileForAdmin(userId);
    if (!removed) {
      throw new NotFoundException('文件不存在');
    }
    await this.uploadsService.removeStoredObject(removed.key);
    await this.auditLogService.record({
      actor,
      action: 'file.delete',
      targetType: 'FILE',
      targetId: userId,
      detail: { fileName: removed.key, kind: 'AVATAR', userId },
    });
  }

  private async removeAttachment(id: string, actor: CurrentAuthUser): Promise<void> {
    if (!isUuid(id)) {
      throw new BadRequestException('ID 格式错误');
    }
    const row = await this.uploadsService.getAttachmentRow(id);
    if (!row) {
      throw new NotFoundException('文件不存在');
    }
    const [usedBySubmissions, referencedKeys] = await Promise.all([
      this.assignmentsService.listUsedAttachmentIds([row.id]),
      this.usersService.findAvatarReferencedKeys([row.key]),
    ]);
    if (usedBySubmissions.has(row.id) || referencedKeys.has(row.key)) {
      throw new ConflictException('文件使用中，不可删除');
    }
    await this.uploadsService.removeAttachment(row.id);
    await this.auditLogService.record({
      actor,
      action: 'file.delete',
      targetType: 'FILE',
      targetId: row.id,
      detail: { fileName: row.originalName, kind: 'ATTACHMENT', key: row.key },
    });
  }
}
