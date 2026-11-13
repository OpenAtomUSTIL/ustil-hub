import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { AnnouncementRow, AnnouncementsRepository } from './announcements.repository';
import { AnnouncementsService } from './announcements.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function row(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000a2',
    slug: '公告标题',
    title: '公告标题',
    content: '公告正文',
    pinned: false,
    authorId: '01890a5d-ac96-7000-8000-000000000001',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as AnnouncementRow;
}

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;

  const announcementsRepository = {
    list: jest.fn(),
    findById: jest.fn(),
    findByIdIncludingDeleted: jest.fn(),
    findByIdOrSlug: jest.fn(),
    slugExists: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    softDeleteById: jest.fn(),
    listDeleted: jest.fn(),
    restoreById: jest.fn(),
  };
  const usersService = {
    getPublicByIds: jest.fn(),
    listActiveUserIds: jest.fn(),
  };
  const notificationsService = {
    notifyUser: jest.fn(),
    notifyUsers: jest.fn(),
  };
  const auditLogService = {
    record: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    announcementsRepository.slugExists.mockResolvedValue(false);
    announcementsRepository.findByIdOrSlug.mockImplementation((v) => announcementsRepository.findById(v));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: AnnouncementsRepository, useValue: announcementsRepository },
        { provide: UsersService, useValue: usersService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();
    service = moduleRef.get(AnnouncementsService);
    usersService.getPublicByIds.mockResolvedValue(
      new Map([
        [
          '01890a5d-ac96-7000-8000-000000000001',
          {
            id: '01890a5d-ac96-7000-8000-000000000001',
            nickname: '负责人',
            avatarUrl: null,
            role: Role.WHEEL,
          },
        ],
      ]),
    );
    usersService.listActiveUserIds.mockResolvedValue(['u-1', 'u-2']);
  });

  it('WHEEL 创建公告成功并返回 AnnouncementItem', async () => {
    announcementsRepository.insert.mockResolvedValue(row());

    const result = await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
      { title: '公告标题', content: '公告正文' },
    );

    expect(result).toEqual({
      id: '01890a5d-ac96-7000-8000-0000000000a2',
      slug: '公告标题',
      title: '公告标题',
      content: '公告正文',
      pinned: false,
      authorId: '01890a5d-ac96-7000-8000-000000000001',
      authorName: '负责人',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(notificationsService.notifyUsers).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'announcement.create' }),
    );
  });

  it('notify=true 时为所有 ACTIVE 用户生成通知', async () => {
    announcementsRepository.insert.mockResolvedValue(row());

    await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
      { title: '公告标题', content: '公告正文', notify: true },
    );

    expect(usersService.listActiveUserIds).toHaveBeenCalled();
    expect(notificationsService.notifyUsers).toHaveBeenCalledWith(['u-1', 'u-2'], {
      type: 'ANNOUNCEMENT',
      title: '公告标题',
      link: '/announcements/公告标题',
    });
  });

  it('MEMBER 创建公告返回 403', async () => {
    await expect(
      service.create(
        { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
        { title: '公告标题', content: '公告正文' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(announcementsRepository.insert).not.toHaveBeenCalled();
  });

  it('非作者且非 ADMIN 编辑/删除公告返回 403', async () => {
    announcementsRepository.findById.mockResolvedValue(row());

    await expect(
      service.update(
        '01890a5d-ac96-7000-8000-0000000000a2',
        { id: 'someone-else', role: Role.WHEEL },
        { title: '新标题' },
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.remove('01890a5d-ac96-7000-8000-0000000000a2', { id: 'someone-else', role: Role.WHEEL }),
    ).rejects.toThrow(ForbiddenException);
    expect(announcementsRepository.softDeleteById).not.toHaveBeenCalled();
  });

  it('ADMIN 可软删他人公告并写 before 快照审计', async () => {
    announcementsRepository.findById.mockResolvedValue(row());

    await service.remove('01890a5d-ac96-7000-8000-0000000000a2', {
      id: 'admin-1',
      role: Role.ADMIN,
    });

    expect(announcementsRepository.softDeleteById).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-0000000000a2');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'announcement.delete',
        detail: { title: '公告标题', content: '公告正文' },
      }),
    );
  });

  it('WHEEL 恢复回收站公告并写审计', async () => {
    announcementsRepository.findByIdIncludingDeleted.mockResolvedValue(row({ deletedAt: now }));

    await service.restore('01890a5d-ac96-7000-8000-0000000000a2', {
      id: 'wheel-1',
      role: Role.WHEEL,
    });

    expect(announcementsRepository.restoreById).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-0000000000a2');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'announcement.restore' }),
    );
  });

  it('重复恢复（未软删）返回 409', async () => {
    announcementsRepository.findByIdIncludingDeleted.mockResolvedValue(row());

    await expect(
      service.restore('01890a5d-ac96-7000-8000-0000000000a2', { id: 'wheel-1', role: Role.WHEEL }),
    ).rejects.toThrow(ConflictException);
    expect(announcementsRepository.restoreById).not.toHaveBeenCalled();
  });
});
