import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { REFRESH_TOKEN_STORE } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TagsService } from '../tags/tags.service';
import { UploadsService } from '../storage/uploads.service';
import { hashPassword } from '../auth/password';
import { UsersRepository, UserRow } from './users.repository';
import { UsersService } from './users.service';

const actor = { id: 'admin-actor', role: Role.ADMIN };

const now = new Date('2026-01-01T00:00:00.000Z');

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '01890a5d-ac96-7000-8000-000000000001',
    email: 'a@example.com',
    phone: null,
    passwordHash: 'hash',
    nickname: '测试用户',
    avatarUrl: null,
    role: Role.MEMBER,
    status: UserStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserRow;
}

describe('UsersService', () => {
  let service: UsersService;

  const usersRepository = {
    insert: jest.fn(),
    findById: jest.fn(),
    findByIds: jest.fn(),
    findByEmailOrPhone: jest.fn(),
    updateProfile: jest.fn(),
    updateIdentifier: jest.fn(),
    updatePasswordHash: jest.fn(),
    updateStatus: jest.fn(),
    listForAdmin: jest.fn(),
    updateRole: jest.fn(),
    deleteById: jest.fn(),
    applyInviteCode: jest.fn(),
    deleteVisitorsCreatedBefore: jest.fn(),
    promoteMembersCreatedBefore: jest.fn(),
    getProfileStats: jest.fn(),
    getProfileTopTags: jest.fn(),
    findPinnedTargets: jest.fn(),
    updateProfilePage: jest.fn(),
    getActivityParts: jest.fn(),
    listRepliesByAuthor: jest.fn(),
  };
  const uploadsService = {
    storeAvatar: jest.fn(),
    saveAssignmentFile: jest.fn(),
    getAttachmentView: jest.fn(),
    getAttachmentViews: jest.fn(),
    removeAttachment: jest.fn(),
    resolveFile: jest.fn(),
  };
  const refreshStore = {
    register: jest.fn(),
    rotate: jest.fn(),
    revokeAll: jest.fn(),
  };
  const notificationsService = {
    notifyUser: jest.fn(),
    notifyUsers: jest.fn(),
  };
  const auditLogService = {
    record: jest.fn(),
  };
  const tagsService = {
    cleanupIssuesOfAuthor: jest.fn(),
    cleanup: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: UploadsService, useValue: uploadsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: TagsService, useValue: tagsService },
        { provide: REFRESH_TOKEN_STORE, useValue: refreshStore },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('getPublic 只返回公开字段，不泄露 email/phone', async () => {
    usersRepository.findById.mockResolvedValue(row());

    const result = await service.getPublic('01890a5d-ac96-7000-8000-000000000001');

    expect(result).toEqual({
      id: '01890a5d-ac96-7000-8000-000000000001',
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
    });
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
  });

  it('换绑标识：当前密码错误返回 400', async () => {
    usersRepository.findById.mockResolvedValue(
      row({ passwordHash: await hashPassword('password123') }),
    );

    await expect(
      service.changeIdentifier('01890a5d-ac96-7000-8000-000000000001', {
        type: 'email',
        value: 'new@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersRepository.updateIdentifier).not.toHaveBeenCalled();
  });

  it('封禁：状态置为 BANNED 并吊销全部 refresh', async () => {
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.updateStatus.mockResolvedValue(row({ status: UserStatus.BANNED }));

    const result = await service.ban('01890a5d-ac96-7000-8000-000000000001', actor);

    expect(result.status).toBe(UserStatus.BANNED);
    expect(refreshStore.revokeAll).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001');
  });

  it('改角色：成功并吊销 refresh，联系方式脱敏', async () => {
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.updateRole.mockResolvedValue(row({ role: Role.ALUMNI }));

    const result = await service.updateRole('01890a5d-ac96-7000-8000-000000000001', Role.ALUMNI, actor);

    expect(result.role).toBe(Role.ALUMNI);
    expect(result.contact).toBe('a***@example.com');
    expect(result).not.toHaveProperty('email');
    expect(refreshStore.revokeAll).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001');
  });

  it('改角色：目标是 ADMIN 返回 403', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.ADMIN }));

    await expect(
      service.updateRole('01890a5d-ac96-7000-8000-000000000001', Role.WHEEL, actor),
    ).rejects.toThrow(ForbiddenException);
    expect(usersRepository.updateRole).not.toHaveBeenCalled();
  });

  it('提前提拔：仅 MEMBER 可升 ALUMNI', async () => {
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.updateRole.mockResolvedValue(row({ role: Role.ALUMNI }));

    const result = await service.promoteToAlumni('01890a5d-ac96-7000-8000-000000000001', actor);
    expect(result.role).toBe(Role.ALUMNI);

    usersRepository.findById.mockResolvedValue(row({ role: Role.ALUMNI }));
    await expect(
      service.promoteToAlumni('01890a5d-ac96-7000-8000-000000000001', actor),
    ).rejects.toThrow(ForbiddenException);
  });

  it('剔除：仅 MEMBER/VISITOR 可删，ALUMNI 返回 403', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.VISITOR }));
    usersRepository.deleteById.mockResolvedValue(row({ role: Role.VISITOR }));

    await service.removeByAdmin('01890a5d-ac96-7000-8000-000000000001', actor);
    expect(refreshStore.revokeAll).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001');
    expect(usersRepository.deleteById).toHaveBeenCalled();

    usersRepository.findById.mockResolvedValue(row({ role: Role.ALUMNI }));
    await expect(
      service.removeByAdmin('01890a5d-ac96-7000-8000-000000000001', actor),
    ).rejects.toThrow(ForbiddenException);
    expect(usersRepository.deleteById).toHaveBeenCalledTimes(1);
  });

  it('持码转正：仅 VISITOR 生效', async () => {
    usersRepository.applyInviteCode.mockResolvedValue(row({ role: Role.MEMBER, inviteCodeId: 'invite-1' } as Partial<UserRow>));

    const result = await service.applyInviteCode('01890a5d-ac96-7000-8000-000000000001', 'invite-1');
    expect(result.role).toBe(Role.MEMBER);

    usersRepository.applyInviteCode.mockResolvedValue(null);
    await expect(service.applyInviteCode('01890a5d-ac96-7000-8000-000000000001', 'invite-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('定时清理：删除满 7 天 VISITOR 并吊销 refresh', async () => {
    usersRepository.deleteVisitorsCreatedBefore.mockResolvedValue(['id-1', 'id-2']);

    const count = await service.cleanupExpiredVisitors();

    expect(count).toBe(2);
    expect(refreshStore.revokeAll).toHaveBeenCalledWith('id-1');
    expect(refreshStore.revokeAll).toHaveBeenCalledWith('id-2');
  });

  it('定时升级：MEMBER 满 4 年升 ALUMNI', async () => {
    usersRepository.promoteMembersCreatedBefore.mockResolvedValue(3);

    const count = await service.promoteExpiredMembers();

    expect(count).toBe(3);
    expect(usersRepository.promoteMembersCreatedBefore).toHaveBeenCalledWith(expect.any(Date));
  });

  it('ADMIN 换绑邮箱/手机返回 403', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.ADMIN }));

    await expect(
      service.changeIdentifier('01890a5d-ac96-7000-8000-000000000001', {
        type: 'email',
        value: 'new@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow('管理员账号初始化后不可修改');
    expect(usersRepository.updateIdentifier).not.toHaveBeenCalled();
  });

  it('改角色：通知目标用户并写审计', async () => {
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.updateRole.mockResolvedValue(row({ role: Role.ALUMNI }));

    await service.updateRole('01890a5d-ac96-7000-8000-000000000001', Role.ALUMNI, actor);

    expect(notificationsService.notifyUser).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000001',
      expect.objectContaining({
        type: 'ROLE',
        body: '你的角色已从 MEMBER 变更为 ALUMNI',
      }),
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.role.change',
        detail: { from: Role.MEMBER, to: Role.ALUMNI },
      }),
    );
  });

  it('剔除：清理 issue taggings 并写审计', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.VISITOR }));
    usersRepository.deleteById.mockResolvedValue(row({ role: Role.VISITOR }));

    await service.removeByAdmin('01890a5d-ac96-7000-8000-000000000001', actor);

    expect(tagsService.cleanupIssuesOfAuthor).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.remove' }),
    );
  });

  // ===== 个人主页 =====

  const selfViewer = { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER };
  const memberViewer = { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER };
  const visitorViewer = { id: '01890a5d-ac96-7000-8000-000000000003', role: Role.VISITOR };

  function mockProfileBasics(): void {
    usersRepository.getProfileStats.mockResolvedValue({
      articles: 1,
      issues: 2,
      replies: 3,
      submissions: 4,
    });
    usersRepository.getProfileTopTags.mockResolvedValue([{ name: 'vue', count: 5 }]);
    usersRepository.findPinnedTargets.mockResolvedValue([]);
  }

  it('个人主页：本人可见联系方式且 isSelf', async () => {
    usersRepository.findById.mockResolvedValue(row({ bio: 'hi', phone: '13800000000' }));
    mockProfileBasics();

    const result = await service.getProfile('01890a5d-ac96-7000-8000-000000000001', selfViewer);

    expect(result.isSelf).toBe(true);
    expect(result.email).toBe('a@example.com');
    expect(result.phone).toBe('13800000000');
    expect(result.bio).toBe('hi');
    expect(result.stats).toEqual({ articles: 1, issues: 2, replies: 3, submissions: 4 });
  });

  it('个人主页：MEMBER 互访只见公开资料，不带联系方式', async () => {
    usersRepository.findById.mockResolvedValue(row());
    mockProfileBasics();

    const result = await service.getProfile('01890a5d-ac96-7000-8000-000000000001', memberViewer);

    expect(result.isSelf).toBe(false);
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
  });

  it('个人主页：VISITOR 访他人 403，访自己放行', async () => {
    usersRepository.findById.mockResolvedValue(row());
    mockProfileBasics();

    await expect(
      service.getProfile('01890a5d-ac96-7000-8000-000000000001', visitorViewer),
    ).rejects.toThrow(ForbiddenException);

    const result = await service.getProfile('01890a5d-ac96-7000-8000-000000000003', visitorViewer);
    expect(result.isSelf).toBe(true);
  });

  it('个人主页：用户不存在 404', async () => {
    usersRepository.findById.mockResolvedValue(null);

    await expect(
      service.getProfile('01890a5d-ac96-7000-8000-000000000001', selfViewer),
    ).rejects.toThrow(NotFoundException);
  });

  it('置顶：按存档顺序解析，软删目标静默跳过', async () => {
    usersRepository.findById.mockResolvedValue(
      row({
        pinnedItems: [
          { type: 'ARTICLE', id: 'art-1' },
          { type: 'ISSUE', id: 'gone-1' },
          { type: 'RESOURCE', id: 'res-1' },
        ],
      } as Partial<UserRow>),
    );
    mockProfileBasics();
    usersRepository.findPinnedTargets.mockResolvedValue([
      { type: 'RESOURCE', id: 'res-1', title: '资源', url: 'https://example.com', ownerId: 'u' },
      { type: 'ARTICLE', id: 'art-1', title: '文章', ownerId: 'u' },
    ]);

    const result = await service.getProfile('01890a5d-ac96-7000-8000-000000000001', selfViewer);

    expect(result.pinnedItems.map((p) => p.id)).toEqual(['art-1', 'res-1']);
    expect(result.pinnedItems[1].url).toBe('https://example.com');
  });

  it('更新主页：bio/readme 超长返回 400', async () => {
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', { bio: 'x'.repeat(101) }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
        profileReadme: 'x'.repeat(10001),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersRepository.updateProfilePage).not.toHaveBeenCalled();
  });

  it('置顶：超过 6 项或重复返回 400', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ type: 'ARTICLE', id: `a-${i}` }));
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', { pinnedItems: seven }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
        pinnedItems: [
          { type: 'ARTICLE', id: 'a-1' },
          { type: 'ARTICLE', id: 'a-1' },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersRepository.findPinnedTargets).not.toHaveBeenCalled();
    expect(usersRepository.updateProfilePage).not.toHaveBeenCalled();
  });

  it('置顶：目标不存在或不属于本人返回 400', async () => {
    usersRepository.findPinnedTargets.mockResolvedValue([]);

    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
        pinnedItems: [{ type: 'ARTICLE', id: 'missing' }],
      }),
    ).rejects.toThrow(BadRequestException);

    usersRepository.findPinnedTargets.mockResolvedValue([
      { type: 'ARTICLE', id: 'others', title: '他人的文章', ownerId: 'someone-else' },
    ]);
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
        pinnedItems: [{ type: 'ARTICLE', id: 'others' }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersRepository.updateProfilePage).not.toHaveBeenCalled();
  });

  it('置顶：本人目标校验通过并写入', async () => {
    usersRepository.findPinnedTargets.mockResolvedValue([
      { type: 'ARTICLE', id: 'mine', title: '我的文章', ownerId: '01890a5d-ac96-7000-8000-000000000001' },
    ]);
    usersRepository.updateProfilePage.mockResolvedValue(row());

    await service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
      pinnedItems: [{ type: 'ARTICLE', id: 'mine' }],
    });

    expect(usersRepository.updateProfilePage).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001', {
      pinnedItems: [{ type: 'ARTICLE', id: 'mine' }],
    });
  });

  it('活跃度：VISITOR 访他人 403', async () => {
    await expect(service.getActivity('01890a5d-ac96-7000-8000-000000000001', visitorViewer)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('活跃度：五类事件按日合并求和，按日期升序', async () => {
    usersRepository.getActivityParts.mockResolvedValue({
      articles: [{ date: '2026-01-02', count: 1 }],
      issues: [
        { date: '2026-01-01', count: 2 },
        { date: '2026-01-02', count: 1 },
      ],
      replies: [{ date: '2026-01-01', count: 1 }],
      submissions: [],
      resources: [{ date: '2025-12-31', count: 3 }],
    });

    const result = await service.getActivity('01890a5d-ac96-7000-8000-000000000001', selfViewer);

    expect(result.days).toEqual([
      { date: '2025-12-31', count: 3 },
      { date: '2026-01-01', count: 3 },
      { date: '2026-01-02', count: 2 },
    ]);
  });

  it('回复 Tab：VISITOR 访他人 403，本人返回分页', async () => {
    await expect(
      service.getReplies('01890a5d-ac96-7000-8000-000000000001', visitorViewer, 1, 10),
    ).rejects.toThrow(ForbiddenException);

    usersRepository.findById.mockResolvedValue(row());
    usersRepository.listRepliesByAuthor.mockResolvedValue({
      rows: [
        {
          id: 'reply-1',
          issueId: 'issue-1',
          issueTitle: '讨论标题',
          content: '回复内容',
          createdAt: now,
        },
      ],
      total: 1,
    });

    const result = await service.getReplies('01890a5d-ac96-7000-8000-000000000001', selfViewer, 1, 10);

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      id: 'reply-1',
      issueId: 'issue-1',
      issueTitle: '讨论标题',
      content: '回复内容',
      createdAt: now.toISOString(),
    });
    expect(usersRepository.listRepliesByAuthor).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000001',
      1,
      10,
    );
  });
});
