import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { IssueStatus } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TagsService } from '../tags/tags.service';
import { UsersService } from '../users/users.service';
import { IssueRow, IssuesRepository, ReplyRow } from './issues.repository';
import { IssuesService } from './issues.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function issueRow(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000e1',
    slug: '问题标题',
    title: '问题标题',
    content: '问题内容',
    authorId: '01890a5d-ac96-7000-8000-000000000002',
    status: IssueStatus.OPEN,
    answeredBy: null,
    answeredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as IssueRow;
}

function replyRow(overrides: Partial<ReplyRow> = {}): ReplyRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000f1',
    issueId: '01890a5d-ac96-7000-8000-0000000000e1',
    authorId: '01890a5d-ac96-7000-8000-000000000001',
    content: '回复内容',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ReplyRow;
}

describe('IssuesService', () => {
  let service: IssuesService;

  const issuesRepository = {
    list: jest.fn(),
    findById: jest.fn(),
    findByIdOrSlug: jest.fn(),
    slugExists: jest.fn(),
    insert: jest.fn(),
    updateStatus: jest.fn(),
    findReplies: jest.fn(),
    insertReply: jest.fn(),
    countReplies: jest.fn(),
    findReplyById: jest.fn(),
    softDeleteReply: jest.fn(),
    restoreReply: jest.fn(),
    listRepliesForAdmin: jest.fn(),
    listDeletedReplies: jest.fn(),
  };
  const usersService = {
    getPublicByIds: jest.fn(),
    searchIdsByKeyword: jest.fn(),
  };
  const tagsService = {
    normalizeTags: jest.fn((tags?: string[]) => tags),
    syncTags: jest.fn(),
    cleanup: jest.fn(),
    getNamesByTargets: jest.fn(),
    findTargetIds: jest.fn(),
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
    issuesRepository.slugExists.mockResolvedValue(false);
    issuesRepository.findByIdOrSlug.mockImplementation((v) => issuesRepository.findById(v));
    const moduleRef = await Test.createTestingModule({
      providers: [
        IssuesService,
        { provide: IssuesRepository, useValue: issuesRepository },
        { provide: UsersService, useValue: usersService },
        { provide: TagsService, useValue: tagsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();
    service = moduleRef.get(IssuesService);
    usersService.getPublicByIds.mockResolvedValue(
      new Map([
        [
          '01890a5d-ac96-7000-8000-000000000001',
          {
            id: '01890a5d-ac96-7000-8000-000000000001',
            nickname: '答疑者',
            avatarUrl: null,
            role: Role.ALUMNI,
          },
        ],
        [
          '01890a5d-ac96-7000-8000-000000000002',
          {
            id: '01890a5d-ac96-7000-8000-000000000002',
            nickname: '提问者',
            avatarUrl: null,
            role: Role.MEMBER,
          },
        ],
      ]),
    );
    tagsService.getNamesByTargets.mockResolvedValue(new Map());
  });

  it('创建 issue 默认 OPEN 并返回详情', async () => {
    issuesRepository.insert.mockResolvedValue(issueRow());

    const result = await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
      { title: '问题标题', content: '问题内容' },
    );

    expect(result.status).toBe(IssueStatus.OPEN);
    expect(result.replies).toEqual([]);
    expect(result.replyCount).toBe(0);
  });

  it('创建 issue 写入标签与审计日志', async () => {
    issuesRepository.insert.mockResolvedValue(issueRow());

    await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
      { title: '问题标题', content: '问题内容', tags: ['drizzle'] },
    );

    expect(tagsService.syncTags).toHaveBeenCalledWith('ISSUE', '01890a5d-ac96-7000-8000-0000000000e1', ['drizzle']);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'issue.create' }),
    );
  });

  it('回复他人 issue 时通知楼主', async () => {
    issuesRepository.findById.mockResolvedValue(issueRow());
    issuesRepository.insertReply.mockResolvedValue(replyRow());

    await service.reply(
      '01890a5d-ac96-7000-8000-0000000000e1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
      { content: '回复内容' },
    );

    expect(notificationsService.notifyUser).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000002',
      expect.objectContaining({ type: 'ISSUE_REPLY', link: '/issues/问题标题' }),
    );
  });

  it('自己回复自己不发通知', async () => {
    issuesRepository.findById.mockResolvedValue(issueRow());
    issuesRepository.insertReply.mockResolvedValue(replyRow({ authorId: '01890a5d-ac96-7000-8000-000000000002' }));

    await service.reply(
      '01890a5d-ac96-7000-8000-0000000000e1',
      { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
      { content: '自问自答' },
    );

    expect(notificationsService.notifyUser).not.toHaveBeenCalled();
  });

  it('VISITOR 创建 issue 返回 403', async () => {
    await expect(
      service.create(
        { id: '01890a5d-ac96-7000-8000-000000000003', role: Role.VISITOR },
        { title: '问题标题', content: '问题内容' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(issuesRepository.insert).not.toHaveBeenCalled();
  });

  it('WHEEL 可变更 issue 状态', async () => {
    issuesRepository.findById
      .mockResolvedValueOnce(issueRow())
      .mockResolvedValueOnce(
        issueRow({
          status: IssueStatus.ANSWERED,
          answeredBy: '01890a5d-ac96-7000-8000-000000000001',
          answeredAt: now,
        }),
      );
    issuesRepository.updateStatus.mockResolvedValue(
      issueRow({
        status: IssueStatus.ANSWERED,
        answeredBy: '01890a5d-ac96-7000-8000-000000000001',
        answeredAt: now,
      }),
    );
    issuesRepository.findReplies.mockResolvedValue([]);

    const result = await service.changeStatus(
      '01890a5d-ac96-7000-8000-0000000000e1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
      { status: IssueStatus.ANSWERED },
    );

    expect(result.status).toBe(IssueStatus.ANSWERED);
    expect(issuesRepository.updateStatus).toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'issue.update', detail: { from: 'OPEN', to: 'ANSWERED' } }),
    );
  });

  it('MEMBER 变更 issue 状态返回 403', async () => {
    await expect(
      service.changeStatus(
        '01890a5d-ac96-7000-8000-0000000000e1',
        { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
        { status: IssueStatus.ANSWERED },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(issuesRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('ALUMNI 将 issue 标记为 ANSWERED 时记录 answeredBy/answeredAt', async () => {
    issuesRepository.findById
      .mockResolvedValueOnce(issueRow())
      .mockResolvedValueOnce(
        issueRow({
          status: IssueStatus.ANSWERED,
          answeredBy: '01890a5d-ac96-7000-8000-000000000001',
          answeredAt: now,
        }),
      );
    issuesRepository.updateStatus.mockResolvedValue(
      issueRow({
        status: IssueStatus.ANSWERED,
        answeredBy: '01890a5d-ac96-7000-8000-000000000001',
        answeredAt: now,
      }),
    );
    issuesRepository.findReplies.mockResolvedValue([replyRow()]);

    const result = await service.changeStatus(
      '01890a5d-ac96-7000-8000-0000000000e1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
      { status: IssueStatus.ANSWERED },
    );

    expect(issuesRepository.updateStatus).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-0000000000e1',
      expect.objectContaining({
        status: IssueStatus.ANSWERED,
        answeredBy: '01890a5d-ac96-7000-8000-000000000001',
      }),
    );
    expect(result.answeredBy?.id).toBe('01890a5d-ac96-7000-8000-000000000001');
    expect(result.status).toBe(IssueStatus.ANSWERED);
  });

  it('WHEEL 软删评论并写 comment.delete 审计（before 快照）', async () => {
    issuesRepository.findReplyById.mockResolvedValue(replyRow());

    await service.softDeleteReply('01890a5d-ac96-7000-8000-0000000000f1', {
      id: 'wheel-1',
      role: Role.WHEEL,
    });

    expect(issuesRepository.softDeleteReply).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-0000000000f1',
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'comment.delete',
        targetType: 'COMMENT',
        detail: { issueId: '01890a5d-ac96-7000-8000-0000000000e1', content: '回复内容' },
      }),
    );
  });

  it('软删已删除/不存在的评论返回 404', async () => {
    issuesRepository.findReplyById.mockResolvedValue(null);
    await expect(
      service.softDeleteReply('01890a5d-ac96-7000-8000-0000000000f1', {
        id: 'wheel-1',
        role: Role.WHEEL,
      }),
    ).rejects.toThrow(NotFoundException);

    issuesRepository.findReplyById.mockResolvedValue(replyRow({ deletedAt: now }));
    await expect(
      service.softDeleteReply('01890a5d-ac96-7000-8000-0000000000f1', {
        id: 'wheel-1',
        role: Role.WHEEL,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(issuesRepository.softDeleteReply).not.toHaveBeenCalled();
  });

  it('恢复评论：写 comment.restore 审计；重复恢复返回 409', async () => {
    issuesRepository.findReplyById.mockResolvedValue(replyRow({ deletedAt: now }));

    await service.restoreReply('01890a5d-ac96-7000-8000-0000000000f1', {
      id: 'wheel-1',
      role: Role.WHEEL,
    });
    expect(issuesRepository.restoreReply).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-0000000000f1',
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'comment.restore' }),
    );

    issuesRepository.findReplyById.mockResolvedValue(replyRow());
    await expect(
      service.restoreReply('01890a5d-ac96-7000-8000-0000000000f1', {
        id: 'wheel-1',
        role: Role.WHEEL,
      }),
    ).rejects.toThrow(ConflictException);
    expect(issuesRepository.restoreReply).toHaveBeenCalledTimes(1);
  });

  it('评论管理列表：keyword 搜内容/作者，含 deletedAt', async () => {
    usersService.searchIdsByKeyword.mockResolvedValue(['01890a5d-ac96-7000-8000-000000000001']);
    issuesRepository.listRepliesForAdmin.mockResolvedValue({
      rows: [
        {
          ...replyRow(),
          issueTitle: '问题标题',
          deletedAt: now,
        },
      ],
      total: 1,
    });

    const result = await service.listRepliesForAdmin(
      { page: 1, pageSize: 20, keyword: '回复' },
      { id: 'wheel-1', role: Role.WHEEL },
    );

    expect(usersService.searchIdsByKeyword).toHaveBeenCalledWith('回复');
    expect(issuesRepository.listRepliesForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: '回复',
        authorIds: ['01890a5d-ac96-7000-8000-000000000001'],
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: '01890a5d-ac96-7000-8000-0000000000f1',
      issueId: '01890a5d-ac96-7000-8000-0000000000e1',
      issueTitle: '问题标题',
      authorName: '答疑者',
      content: '回复内容',
      deletedAt: now.toISOString(),
    });
  });
});
