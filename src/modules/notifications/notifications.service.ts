import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Page } from '../../common/dto/page';
import { NotificationType } from '../../db/schema';
import {
  MAIL_RECIPIENT_RESOLVER,
  MailRecipientResolver,
} from '../mail/mail.types';
import { signUnsubscribeToken } from '../mail/link-tokens';
import { MailService } from '../mail/mail.service';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { NotificationRow, NotificationsRepository } from './notifications.repository';
import { NotificationItem } from './notifications.views';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  /** 邮件副本展示字段（v12.0）：回复类通知的回复人与内容摘要 */
  actorNickname?: string;
  excerpt?: string;
}

/** 站内通知：写入失败只告警不打断业务主流程 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // MAIL_RECIPIENT_RESOLVER（users 模块 @Global 导出）经 ModuleRef 调用时惰性获取——
  // 构造注入会形成 Users↔Notifications 的 provider 环导致 Nest 初始化死锁
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly mailService: MailService,
    private readonly crypto: CryptoService,
    private readonly moduleRef: ModuleRef,
  ) {}

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
      return;
    }
    // 邮件副本（v12.0）：静默降级，不影响站内通知与业务主流程
    void this.sendNoticeMails(userIds, input);
  }

  /** 通知邮件副本：仅发给「已验证邮箱 + 邮件提醒开启 + ACTIVE」的收件人（解析在 users 模块） */
  private async sendNoticeMails(userIds: string[], input: NotifyInput): Promise<void> {
    try {
      if (this.mailService.driver === 'none') {
        return;
      }
      const resolveMailRecipients = this.moduleRef.get<MailRecipientResolver>(MAIL_RECIPIENT_RESOLVER, {
        strict: false,
      });
      if (!resolveMailRecipients) {
        return;
      }
      const recipients = await resolveMailRecipients(userIds);
      const actionPath = (input.link ?? '').replace(/^\//, '');
      for (const recipient of recipients) {
        const unsubscribePath = `unsubscribe?token=${signUnsubscribeToken(this.crypto, recipient.userId)}`;
        if (input.type === 'ISSUE_REPLY' && input.actorNickname) {
          await this.mailService.send(recipient.email, 'notice-reply', {
            actorNickname: input.actorNickname,
            scope: '讨论',
            contentTitle: input.title,
            replyExcerpt: input.excerpt ?? input.body ?? '',
            actionPath,
            unsubscribePath,
          });
        } else {
          await this.mailService.send(recipient.email, 'notice-generic', {
            title: input.title,
            summary: input.body ?? input.title,
            actionPath,
            unsubscribePath,
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        `notice mail failed: ${error instanceof Error ? error.message : String(error)}`,
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
