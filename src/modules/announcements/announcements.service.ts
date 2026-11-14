import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Page } from '../../common/dto/page';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { insertWithUniqueSlug } from '../../common/utils/identifiers';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { AnnouncementRow, AnnouncementsRepository } from './announcements.repository';
import { AnnouncementItem } from './announcements.views';
import { AnnouncementsQueryDto } from './dto/announcements-query.dto';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcements.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly announcementsRepository: AnnouncementsRepository,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private toItem(row: AnnouncementRow, authorName: string, authorUsername: string): AnnouncementItem {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      content: row.content,
      pinned: row.pinned,
      authorId: row.authorId,
      authorName,
      authorUsername,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async authorOf(row: AnnouncementRow): Promise<{ nickname: string; username: string }> {
    const map = await this.usersService.getPublicByIds([row.authorId]);
    const author = map.get(row.authorId);
    if (!author) {
      throw new NotFoundException('用户不存在');
    }
    return { nickname: author.nickname, username: author.username };
  }

  async list(query: AnnouncementsQueryDto): Promise<Page<AnnouncementItem>> {
    const { rows, total } = await this.announcementsRepository.list(
      query.page,
      query.pageSize,
      query.keyword,
    );
    const authors = await this.usersService.getPublicByIds(rows.map((row) => row.authorId));
    return {
      items: rows.map((row) => {
        const author = authors.get(row.authorId);
        if (!author) {
          throw new NotFoundException('用户不存在');
        }
        return this.toItem(row, author.nickname, author.username);
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getDetail(id: string): Promise<AnnouncementItem> {
    const row = await this.announcementsRepository.findByIdOrSlug(id);
    if (!row) {
      throw new NotFoundException('公告不存在');
    }
    const author = await this.authorOf(row);
    return this.toItem(row, author.nickname, author.username);
  }

  async create(user: CurrentAuthUser, dto: CreateAnnouncementDto): Promise<AnnouncementItem> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await insertWithUniqueSlug(
      dto.title,
      (slug) => this.announcementsRepository.slugExists(slug),
      (slug) => this.announcementsRepository.insert({
        title: dto.title,
        slug,
        content: dto.content,
        pinned: dto.pinned ?? false,
        authorId: user.id,
      }),
    );
    if (dto.notify) {
      const userIds = await this.usersService.listActiveUserIds();
      await this.notificationsService.notifyUsers(userIds, {
        type: 'ANNOUNCEMENT',
        title: row.title,
        link: `/announcements/${row.slug}`,
      });
    }
    await this.auditLogService.record({
      actor: user,
      action: 'announcement.create',
      targetType: 'ANNOUNCEMENT',
      targetId: row.id,
      detail: { title: row.title },
    });
    return this.toItem(row, ...(await this.toAuthorPair(row)));
  }

  private async toAuthorPair(
    row: AnnouncementRow,
  ): Promise<[authorName: string, authorUsername: string]> {
    const author = await this.authorOf(row);
    return [author.nickname, author.username];
  }

  async update(
    id: string,
    user: CurrentAuthUser,
    dto: UpdateAnnouncementDto,
  ): Promise<AnnouncementItem> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.announcementsRepository.findById(id);
    if (!row) {
      throw new NotFoundException('公告不存在');
    }
    if (row.authorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    const updated =
      dto.title === undefined && dto.content === undefined && dto.pinned === undefined
        ? row
        : ((await this.announcementsRepository.update(id, {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.content !== undefined ? { content: dto.content } : {}),
            ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
          })) ?? row);
    await this.auditLogService.record({
      actor: user,
      action: 'announcement.update',
      targetType: 'ANNOUNCEMENT',
      targetId: id,
      detail: { title: updated.title },
    });
    return this.toItem(updated, ...(await this.toAuthorPair(updated)));
  }

  async remove(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.announcementsRepository.findById(id);
    if (!row) {
      throw new NotFoundException('公告不存在');
    }
    if (row.authorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    await this.announcementsRepository.softDeleteById(id);
    await this.auditLogService.record({
      actor: user,
      action: 'announcement.delete',
      targetType: 'ANNOUNCEMENT',
      targetId: id,
      detail: { title: row.title, content: row.content.slice(0, 200) },
    });
  }

  // ===== 回收站 =====

  async listDeleted(
    page: number,
    pageSize: number,
  ): Promise<{ rows: AnnouncementRow[]; total: number }> {
    return this.announcementsRepository.listDeleted(page, pageSize);
  }

  async restore(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.announcementsRepository.findByIdIncludingDeleted(id);
    if (!row) {
      throw new NotFoundException('公告不存在');
    }
    if (!row.deletedAt) {
      throw new ConflictException('内容未被删除，无需恢复');
    }
    await this.announcementsRepository.restoreById(id);
    await this.auditLogService.record({
      actor: user,
      action: 'announcement.restore',
      targetType: 'ANNOUNCEMENT',
      targetId: id,
      detail: { title: row.title },
    });
  }
}
