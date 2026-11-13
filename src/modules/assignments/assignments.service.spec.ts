import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../storage/uploads.service';
import { UsersService } from '../users/users.service';
import {
  AssignmentRow,
  AssignmentsRepository,
  SubmissionRow,
} from './assignments.repository';
import { AssignmentsService } from './assignments.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function assignmentRow(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000b1',
    slug: '作业一',
    title: '作业一',
    description: '作业描述',
    publisherId: '01890a5d-ac96-7000-8000-000000000001',
    startAt: new Date('2025-12-01T00:00:00.000Z'),
    deadlineAt: new Date('2999-01-01T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as AssignmentRow;
}

const attachmentView = {
  id: '01890a5d-ac96-7000-8000-0000000000c1',
  key: '01890a5d-ac96-7000-8000-0000000000c2.pdf',
  originalName: 'work.pdf',
  size: 100,
  mime: 'application/pdf',
  url: '/api/v1/storage/files/01890a5d-ac96-7000-8000-0000000000c2.pdf',
};

function submissionRow(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000d1',
    assignmentId: '01890a5d-ac96-7000-8000-0000000000b1',
    submitterId: '01890a5d-ac96-7000-8000-000000000002',
    note: '提交备注',
    attachmentId: attachmentView.id,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as SubmissionRow;
}

describe('AssignmentsService', () => {
  let service: AssignmentsService;

  const assignmentsRepository = {
    list: jest.fn(),
    findById: jest.fn(),
    findByIdOrSlug: jest.fn(),
    slugExists: jest.fn(),
    findByIds: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    findMySubmissions: jest.fn(),
    findSubmission: jest.fn(),
    upsertSubmission: jest.fn(),
    listSubmissions: jest.fn(),
    listBySubmitter: jest.fn(),
  };
  const usersService = {
    getPublicByIds: jest.fn(),
    listUserIdsByRoles: jest.fn(),
    listActiveUserIds: jest.fn(),
  };
  const uploadsService = {
    saveAssignmentFile: jest.fn(),
    getAttachmentView: jest.fn(),
    getAttachmentViews: jest.fn(),
    removeAttachment: jest.fn(),
    storeAvatar: jest.fn(),
    resolveFile: jest.fn(),
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
    assignmentsRepository.slugExists.mockResolvedValue(false);
    assignmentsRepository.findByIdOrSlug.mockImplementation((v) => assignmentsRepository.findById(v));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: AssignmentsRepository, useValue: assignmentsRepository },
        { provide: UsersService, useValue: usersService },
        { provide: UploadsService, useValue: uploadsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();
    service = moduleRef.get(AssignmentsService);
    usersService.getPublicByIds.mockResolvedValue(
      new Map([
        [
          '01890a5d-ac96-7000-8000-000000000001',
          {
            id: '01890a5d-ac96-7000-8000-000000000001',
            nickname: '发布者',
            avatarUrl: null,
            role: Role.ALUMNI,
          },
        ],
        [
          '01890a5d-ac96-7000-8000-000000000002',
          {
            id: '01890a5d-ac96-7000-8000-000000000002',
            nickname: '成员',
            avatarUrl: null,
            role: Role.MEMBER,
          },
        ],
      ]),
    );
  });

  it('MEMBER 在开放窗口内提交作业成功，返回 SubmissionView', async () => {
    assignmentsRepository.findById.mockResolvedValue(assignmentRow());
    assignmentsRepository.findSubmission.mockResolvedValue(null);
    uploadsService.saveAssignmentFile.mockResolvedValue(attachmentView);
    assignmentsRepository.upsertSubmission.mockResolvedValue(submissionRow());

    const result = await service.submit(
      '01890a5d-ac96-7000-8000-0000000000b1',
      { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
      {
        buffer: Buffer.from('pdf'),
        originalname: 'work.pdf',
        mimetype: 'application/pdf',
        size: 3,
      },
      { note: '提交备注' },
    );

    expect(result.attachment.id).toBe(attachmentView.id);
    expect(result.submitter.id).toBe('01890a5d-ac96-7000-8000-000000000002');
    expect(assignmentsRepository.upsertSubmission).toHaveBeenCalled();
  });

  it('超过截止时间提交返回 403', async () => {
    assignmentsRepository.findById.mockResolvedValue(
      assignmentRow({
        startAt: new Date('2020-01-01T00:00:00.000Z'),
        deadlineAt: new Date('2020-01-02T00:00:00.000Z'),
      }),
    );

    await expect(
      service.submit(
        '01890a5d-ac96-7000-8000-0000000000b1',
        { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
        {
          buffer: Buffer.from('pdf'),
          originalname: 'work.pdf',
          mimetype: 'application/pdf',
          size: 3,
        },
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(uploadsService.saveAssignmentFile).not.toHaveBeenCalled();
  });

  it('WHEEL 提交作业返回 403', async () => {
    assignmentsRepository.findById.mockResolvedValue(assignmentRow());

    await expect(
      service.submit(
        '01890a5d-ac96-7000-8000-0000000000b1',
        { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
        {
          buffer: Buffer.from('pdf'),
          originalname: 'work.pdf',
          mimetype: 'application/pdf',
          size: 3,
        },
        {},
      ),
    ).rejects.toThrow('仅学习成员或校友可提交作业');
    expect(uploadsService.saveAssignmentFile).not.toHaveBeenCalled();
  });

  it('VISITOR 浏览作业列表返回 403', async () => {
    await expect(
      service.list({ page: 1, pageSize: 20 }, { id: '01890a5d-ac96-7000-8000-000000000003', role: Role.VISITOR }),
    ).rejects.toThrow(ForbiddenException);
    expect(assignmentsRepository.list).not.toHaveBeenCalled();
  });

  it('创建作业：截止时间不晚于开始时间返回 400', async () => {
    await expect(
      service.create(
        { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
        {
          title: '作业一',
          description: '描述',
          startAt: new Date('2026-01-02T00:00:00.000Z'),
          deadlineAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(assignmentsRepository.insert).not.toHaveBeenCalled();
  });

  it('发布作业：通知 MEMBER+ALUMNI 并写审计', async () => {
    assignmentsRepository.insert.mockResolvedValue(assignmentRow());
    assignmentsRepository.findById.mockResolvedValue(assignmentRow());
    assignmentsRepository.findSubmission.mockResolvedValue(null);
    usersService.listUserIdsByRoles.mockResolvedValue(['u-1', 'u-2']);

    await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
      {
        title: '作业一',
        description: '描述',
        startAt: new Date('2025-12-01T00:00:00.000Z'),
        deadlineAt: new Date('2999-01-01T00:00:00.000Z'),
      },
    );

    expect(usersService.listUserIdsByRoles).toHaveBeenCalledWith([Role.MEMBER, Role.ALUMNI]);
    expect(notificationsService.notifyUsers).toHaveBeenCalledWith(
      ['u-1', 'u-2'],
      expect.objectContaining({ type: 'ASSIGNMENT', link: '/assignments/作业一' }),
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignment.create' }),
    );
  });

  it('我的提交：VISITOR 返回 403', async () => {
    await expect(
      service.listMySubmissions(
        { id: '01890a5d-ac96-7000-8000-000000000003', role: Role.VISITOR },
        { page: 1, pageSize: 20 },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(assignmentsRepository.listBySubmitter).not.toHaveBeenCalled();
  });

  it('我的提交：仅返回本人数据并派生状态', async () => {
    assignmentsRepository.listBySubmitter.mockResolvedValue({ rows: [submissionRow()], total: 1 });
    assignmentsRepository.findByIds.mockResolvedValue([assignmentRow()]);
    uploadsService.getAttachmentViews.mockResolvedValue(
      new Map([[attachmentView.id, attachmentView]]),
    );

    const result = await service.listMySubmissions(
      { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
      { page: 1, pageSize: 20 },
    );

    expect(assignmentsRepository.listBySubmitter).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000002',
      1,
      20,
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      id: '01890a5d-ac96-7000-8000-0000000000d1',
      assignmentId: '01890a5d-ac96-7000-8000-0000000000b1',
      assignmentSlug: '作业一',
      assignmentTitle: '作业一',
      startAt: '2025-12-01T00:00:00.000Z',
      deadlineAt: '2999-01-01T00:00:00.000Z',
      state: 'OPEN',
      note: '提交备注',
      attachment: { id: attachmentView.id, fileName: 'work.pdf' },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });
});
