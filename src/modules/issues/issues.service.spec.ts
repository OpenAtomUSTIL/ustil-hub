import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { IssueStatus } from '../../db/schema';
import { UsersService } from '../users/users.service';
import { IssueRow, IssuesRepository, ReplyRow } from './issues.repository';
import { IssuesService } from './issues.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function issueRow(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000e1',
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
    insert: jest.fn(),
    updateStatus: jest.fn(),
    findReplies: jest.fn(),
    insertReply: jest.fn(),
    countReplies: jest.fn(),
  };
  const usersService = {
    getPublicByIds: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        IssuesService,
        { provide: IssuesRepository, useValue: issuesRepository },
        { provide: UsersService, useValue: usersService },
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
});
