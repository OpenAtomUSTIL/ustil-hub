import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MAIL_RECIPIENT_RESOLVER } from '../mail/mail.types';
import { MailService } from '../mail/mail.service';
import { NotificationRow, NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000n1',
    userId: '01890a5d-ac96-7000-8000-000000000002',
    type: 'ANNOUNCEMENT',
    title: '公告标题',
    body: null,
    link: '/announcements/1',
    readAt: null,
    createdAt: now,
    ...overrides,
  } as NotificationRow;
}

describe('NotificationsService', () => {
  let service: NotificationsService;

  const repository = {
    insertMany: jest.fn(),
    listByUser: jest.fn(),
    countUnread: jest.fn(),
    findById: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  };
  // v12.0 通知邮件副本：driver=none 短路（默认），用例切换 driver 验证发信路径
  const mailService = { send: jest.fn(), driver: 'none' };
  const cryptoStub = { hmac: (plaintext: string): string => 'h:' + plaintext };
  const resolveMailRecipients = jest.fn();

  const me = { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER };

  beforeEach(async () => {
    jest.clearAllMocks();
    // clearAllMocks 不清实现，逐个复位避免用例间互相污染
    repository.insertMany.mockReset();
    mailService.driver = 'none';
    resolveMailRecipients.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: repository },
        { provide: MailService, useValue: mailService },
        { provide: CryptoService, useValue: cryptoStub },
        { provide: MAIL_RECIPIENT_RESOLVER, useValue: resolveMailRecipients },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('批量写入通知：每个用户一条', async () => {
    await service.notifyUsers(['u-1', 'u-2'], {
      type: 'ASSIGNMENT',
      title: '作业一',
      link: '/assignments/1',
    });

    expect(repository.insertMany).toHaveBeenCalledWith([
      { userId: 'u-1', type: 'ASSIGNMENT', title: '作业一', body: null, link: '/assignments/1' },
      { userId: 'u-2', type: 'ASSIGNMENT', title: '作业一', body: null, link: '/assignments/1' },
    ]);
  });

  it('写入失败不抛出（失败静默）', async () => {
    repository.insertMany.mockRejectedValue(new Error('db down'));
    await expect(
      service.notifyUser('u-1', { type: 'ROLE', title: '角色变更' }),
    ).resolves.toBeUndefined();
  });

  it('列表只返回本人通知', async () => {
    repository.listByUser.mockResolvedValue({ rows: [row()], total: 1 });

    const result = await service.list({ page: 1, pageSize: 20 }, me);

    expect(repository.listByUser).toHaveBeenCalledWith(me.id, { page: 1, pageSize: 20 });
    expect(result.items[0].title).toBe('公告标题');
    expect(result.items[0].readAt).toBeNull();
  });

  it('标记已读：他人通知返回 404', async () => {
    repository.findById.mockResolvedValue(row({ userId: 'someone-else' }));

    await expect(
      service.markRead('01890a5d-ac96-7000-8000-0000000000n1', me),
    ).rejects.toThrow(NotFoundException);
    expect(repository.markRead).not.toHaveBeenCalled();
  });

  it('标记已读与全部已读：仅作用于本人', async () => {
    repository.findById.mockResolvedValue(row());
    await service.markRead('01890a5d-ac96-7000-8000-0000000000n1', me);
    expect(repository.markRead).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-0000000000n1', expect.any(Date));

    await service.markAllRead(me);
    expect(repository.markAllRead).toHaveBeenCalledWith(me.id, expect.any(Date));
  });

  it('未读数只统计本人', async () => {
    repository.countUnread.mockResolvedValue(3);
    const result = await service.unreadCount(me);
    expect(result).toEqual({ count: 3 });
    expect(repository.countUnread).toHaveBeenCalledWith(me.id);
  });

  // ===== 通知邮件副本（v12.0）=====

  /** sendNoticeMails 是 void 副作用，先冲刷微任务再断言 */
  const flushMails = () => new Promise((resolve) => setImmediate(resolve));

  it('邮件副本：回复类通知发 notice-reply，带退订链接', async () => {
    mailService.driver = 'smtp';
    resolveMailRecipients.mockResolvedValue([
      { userId: 'u-1', email: 'u1@example.com', nickname: 'U1', online: false },
    ]);

    await service.notifyUsers(['u-1'], {
      type: 'ISSUE_REPLY',
      title: '讨论标题',
      link: '/issues/1',
      actorNickname: '张三',
      excerpt: '回复摘要',
    });
    await flushMails();

    expect(mailService.send).toHaveBeenCalledWith(
      'u1@example.com',
      'notice-reply',
      expect.objectContaining({
        actorNickname: '张三',
        actionPath: 'issues/1',
        unsubscribePath: expect.stringContaining('unsubscribe?token=u-1.'),
      }),
    );
  });

  it('邮件副本：回复类收件人在线时不发（站内通知已可见），不在线照发', async () => {
    mailService.driver = 'smtp';
    resolveMailRecipients.mockResolvedValue([
      { userId: 'u-on', email: 'on@example.com', nickname: '在线', online: true },
      { userId: 'u-off', email: 'off@example.com', nickname: '离线', online: false },
    ]);

    await service.notifyUsers(['u-on', 'u-off'], {
      type: 'ISSUE_REPLY',
      title: '讨论标题',
      actorNickname: '张三',
      excerpt: '回复摘要',
    });
    await flushMails();

    expect(mailService.send).toHaveBeenCalledTimes(1);
    expect(mailService.send).toHaveBeenCalledWith('off@example.com', 'notice-reply', expect.anything());
  });

  it('邮件副本：通用通知发 notice-generic（在线不抑制）；driver=none 不解析收件人', async () => {
    mailService.driver = 'api';
    resolveMailRecipients.mockResolvedValue([
      { userId: 'u-1', email: 'u1@example.com', nickname: 'U1', online: true },
    ]);

    await service.notifyUsers(['u-1'], { type: 'ANNOUNCEMENT', title: '公告', body: '内容' });
    await flushMails();

    expect(mailService.send).toHaveBeenCalledWith(
      'u1@example.com',
      'notice-generic',
      expect.objectContaining({ title: '公告', summary: '内容' }),
    );

    mailService.send.mockClear();
    resolveMailRecipients.mockClear();
    mailService.driver = 'none';
    await service.notifyUsers(['u-1'], { type: 'ANNOUNCEMENT', title: '公告' });
    await flushMails();
    expect(resolveMailRecipients).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('邮件副本：收件人解析失败静默降级，不影响站内通知', async () => {
    mailService.driver = 'smtp';
    resolveMailRecipients.mockRejectedValue(new Error('db down'));

    await expect(
      service.notifyUsers(['u-1'], { type: 'ROLE', title: '角色变更' }),
    ).resolves.toBeUndefined();
    await flushMails();
    expect(repository.insertMany).toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });
});
