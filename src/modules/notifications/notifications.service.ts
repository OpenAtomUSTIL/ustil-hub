import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Page } from '../../common/dto/page';
import { NotificationType } from '../../db/schema';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { NotificationRow, NotificationsRepository } from './notifications.repository';
import { NotificationItem } from './notifications.views';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** 站内通知：写入失败只告警不打断业务主流程 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly notificationsRepository: NotificationsRepository) {}

  private toItem(row: NotificationRow): NotificationItem {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async notifyUser(userId: string, input: NotifyInput): Promise<void> {
    await this.notifyUsers([userId], input);
  }

  async notifyUsers(userIds: string[], input: NotifyInput): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    try {
      await this.notificationsRepository.insertMany(
        userIds.map((userId) => ({
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
        })),
      );
    } catch (error) {
      this.logger.warn(
        `notification write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async list(query: NotificationsQueryDto, user: CurrentAuthUser): Promise<Page<NotificationItem>> {
    const { rows, total } = await this.notificationsRepository.listByUser(user.id, query);
    return {
      items: rows.map((row) => this.toItem(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async unreadCount(user: CurrentAuthUser): Promise<{ count: number }> {
    return { count: await this.notificationsRepository.countUnread(user.id) };
  }

  async markRead(id: string, user: CurrentAuthUser): Promise<void> {
    const row = await this.notificationsRepository.findById(id);
    if (!row || row.userId !== user.id) {
      throw new NotFoundException('通知不存在');
    }
    await this.notificationsRepository.markRead(id, new Date());
  }

  async markAllRead(user: CurrentAuthUser): Promise<void> {
    await this.notificationsRepository.markAllRead(user.id, new Date());
  }
}
