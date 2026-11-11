import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
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
  attachment?: AttachmentRow;
  avatar?: AvatarFileRef;
}

/** 管理后台文件管理：附件 + 用户头像文件（合成 AVATAR 条目） */
@Injectable()
export class AdminFilesService {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly usersService: UsersService,
    private readonly assignmentsService: AssignmentsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private isImage(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXTS.has(ext);
  }

  private mergeByCreatedAt(entries: MergedEntry[]): MergedEntry[] {
    return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async list(query: AdminFilesQueryDto, actor: CurrentAuthUser): Promise<Page<FileItem>> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const offset = (query.page - 1) * query.pageSize;
    const windowSize = offset + query.pageSize;
    const wantAttachment = !query.kind || query.kind === 'ATTACHMENT';
    const wantAvatar = !query.kind || query.kind === 'AVATAR';

    const [attachmentResult, avatarResult] = await Promise.all([
      wantAttachment
        ? this.uploadsService.listForAdminWindow({ keyword: query.keyword, limit: windowSize })
        : { rows: [] as AttachmentRow[], total: 0 },
      wantAvatar
        ? this.usersService.listAvatarFilesForAdmin({ keyword: query.keyword, limit: windowSize })
        : { rows: [] as AvatarFileRef[], total: 0 },
    ]);

    const entries = this.mergeByCreatedAt([
      ...attachmentResult.rows.map((row) => ({
        kind: 'ATTACHMENT' as const,
        id: row.id,
        fileName: row.originalName,
        createdAt: row.createdAt,
        attachment: row,
      })),
      ...avatarResult.rows.map((ref) => ({
        kind: 'AVATAR' as const,
        id: `${AVATAR_ID_PREFIX}${ref.userId}`,
        fileName: ref.key,
        createdAt: ref.updatedAt,
        avatar: ref,
      })),
    ]).slice(offset, offset + query.pageSize);

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
      total: attachmentResult.total + avatarResult.total,
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

  /** 管理端文件内容预览（附件与头像统一出口，WHEEL/ADMIN 均可读，绕开提交归属限制） */
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
    return this.uploadsService.readAttachment(row.id);
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
