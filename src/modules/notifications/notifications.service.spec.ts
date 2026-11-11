import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
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

  const me = { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: repository },
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
});
