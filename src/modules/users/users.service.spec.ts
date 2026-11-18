import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../../common/decorators/roles.decorator';
import { CryptoService } from '../../common/crypto/crypto.service';
import { REFRESH_TOKEN_STORE } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { CaptchaService } from '../captcha/captcha.service';
import { EmailCodeService } from '../mail/email-code.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../storage/uploads.service';
import { hashPassword } from '../auth/password';
import { UpdateProfilePageDto } from './dto/update-profile-page.dto';
import { UsersRepository, UserRow } from './users.repository';
import { UsersService, computeStreak } from './users.service';

const actor = { id: 'admin-actor', role: Role.ADMIN };

const now = new Date('2026-01-01T00:00:00.000Z');

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '01890a5d-ac96-7000-8000-000000000001',
    email: 'a@example.com',
    phone: null,
    cryptoId: 'a'.repeat(32),
    passwordHash: 'hash',
    nickname: '测试用户',
    username: 'testuser',
    avatarUrl: null,
    bio: null,
    role: Role.MEMBER,
    status: UserStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserRow;
}

// CryptoService 打桩（v10.0）：seal 加 'v1.test.' 前缀、open 去前缀还原，hmac 加 'h:' 前缀，cryptoId 固定 32 位
const cryptoStub = {
  newCryptoId: (): string => 'a'.repeat(32),
  seal: (_purpose: string, plaintext: string | null | undefined): string | null =>
    plaintext ? 'v1.test.' + plaintext : null,
  open: (_purpose: string, token: string | null | undefined): string | null =>
    token ? token.replace('v1.test.', '') : null,
  hmac: (plaintext: string): string => 'h:' + plaintext,
};

const transaction = {};

describe('UsersService', () => {
  let service: UsersService;

  const usersRepository = {
    withUsernameLock: jest.fn(),
    withUserLock: jest.fn(),
    findIdentifierCandidates: jest.fn(),
    insert: jest.fn(),
    findById: jest.fn(),
    findByUsername: jest.fn(),
    findByIdOrUsername: jest.fn(),
    findByEmailHmacOrPhoneHmac: jest.fn(),
    findByEmailHmac: jest.fn(),
    findByPhoneHmac: jest.fn(),
    usernameExists: jest.fn(),
    updateUsername: jest.fn(),
    insertFollow: jest.fn(),
    deleteFollow: jest.fn(),
    isFollowing: jest.fn(),
    getFollowCounts: jest.fn(),
    listFollowers: jest.fn(),
    listFollowing: jest.fn(),
    filterFollowedIds: jest.fn(),
    findByIds: jest.fn(),
    updateProfile: jest.fn(),
    updateIdentifier: jest.fn(),
    updateNoticePref: jest.fn(),
    updatePasswordHash: jest.fn(),
    updateStatus: jest.fn(),
    listForAdmin: jest.fn(),
    updateRole: jest.fn(),
    deleteById: jest.fn(),
    applyInviteCode: jest.fn(),
    listExpiredVisitorIds: jest.fn(),
    promoteMembersCreatedBefore: jest.fn(),
    getProfileStats: jest.fn(),
    getProfileTopTags: jest.fn(),
    findPinnedTargets: jest.fn(),
    updateProfilePage: jest.fn(),
    getActivityParts: jest.fn(),
    listRepliesByAuthor: jest.fn(),
  };
  const uploadsService = {
    flushPendingFileDeletions: jest.fn().mockResolvedValue(0),
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
  // v8.0：剔除 purge 并入 deleteById 事务，UsersService 不再依赖 TagsService
  // v6.0：changeIdentifier 起手先过图形验证码，单测直接打桩放行
  const captchaService = {
    validate: jest.fn(),
    create: jest.fn(),
  };
  // v12.0：换绑邮箱需新邮箱邮件验证码（purpose=rebind，一次性消费）
  const emailCodeService = {
    validate: jest.fn(),
    issue: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    emailCodeService.validate.mockResolvedValue(undefined);
    usersRepository.findIdentifierCandidates.mockReset().mockResolvedValue([]);
    usersRepository.insert.mockReset();
    usersRepository.withUsernameLock.mockImplementation((operation) => operation(transaction));
    usersRepository.withUserLock.mockImplementation(async (id, operation) => operation(await usersRepository.findById(id), transaction));
    usersRepository.findByIdOrUsername.mockImplementation((v: string) =>
      usersRepository.findById(v),
    );
    // HMAC 查找原语默认未命中（uuid 寻址用例只走 findById）
    usersRepository.findByEmailHmacOrPhoneHmac.mockResolvedValue(null);
    usersRepository.findByEmailHmac.mockResolvedValue(null);
    usersRepository.findByPhoneHmac.mockResolvedValue(null);
    usersRepository.getFollowCounts.mockResolvedValue({ followers: 0, following: 0 });
    usersRepository.isFollowing.mockResolvedValue(false);
    usersRepository.filterFollowedIds.mockResolvedValue(new Set());
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: CryptoService, useValue: cryptoStub },
        { provide: UploadsService, useValue: uploadsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: CaptchaService, useValue: captchaService },
        { provide: EmailCodeService, useValue: emailCodeService },
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
      username: 'testuser',
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
        captchaId: 'captcha-1',
        captchaCode: 'ABCDE',
        type: 'email',
        value: 'new@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersRepository.updateIdentifier).not.toHaveBeenCalled();
  });

  it.each([
    { email: ' A@Example.com ', emailHmac: null, cryptoId: null },
    { email: 'v1.test.a@example.com', emailHmac: null, cryptoId: 'a'.repeat(32) },
    { email: 'v1.test.a@example.com', emailHmac: 'h:a@example.com', cryptoId: 'a'.repeat(32) },
  ])('注册拒绝相同邮箱，包括尚未回填的账号：%j', async (existing) => {
    usersRepository.findIdentifierCandidates.mockResolvedValue([row(existing)]);
    await expect(service.createUser({ email: ' A@EXAMPLE.COM ', passwordHash: 'hash', nickname: 'new' }))
      .rejects.toThrow(ConflictException);
    expect(usersRepository.insert).not.toHaveBeenCalled();
    expect(usersRepository.findIdentifierCandidates).toHaveBeenCalledWith('h:a@example.com', null, transaction);
  });

  it('并发注册同一邮箱仅允许一次成功', async () => {
    const saved: UserRow[] = [];
    let queue = Promise.resolve();
    usersRepository.withUsernameLock.mockImplementation((operation) => {
      const result = queue.then(() => operation(transaction));
      queue = result.then(() => undefined, () => undefined);
      return result;
    });
    usersRepository.findIdentifierCandidates.mockImplementation(async () => saved);
    usersRepository.insert.mockImplementation(async (input) => {
      const created = row(input);
      saved.push(created);
      return created;
    });
    const results = await Promise.allSettled(['a@example.com', ' A@EXAMPLE.COM '].map((email) =>
      service.createUser({ email, passwordHash: 'hash', nickname: 'new' })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(usersRepository.insert).toHaveBeenCalledTimes(1);
  });

  it('缺失 HMAC 的手机号同样不能重复注册', async () => {
    usersRepository.findIdentifierCandidates.mockResolvedValue([row({ email: null, phone: '13800138000', phoneHmac: null, cryptoId: null })]);
    await expect(service.createUser({ phone: '13800138000', passwordHash: 'hash', nickname: 'new' })).rejects.toThrow(ConflictException);
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('未回填的不同邮箱不应阻止注册', async () => {
    usersRepository.findIdentifierCandidates.mockResolvedValue([row({ email: 'other@example.com', emailHmac: null, cryptoId: null })]);
    usersRepository.insert.mockResolvedValue(row());
    await expect(service.createUser({ email: 'a@example.com', passwordHash: 'hash', nickname: 'new' })).resolves.toBeDefined();
  });

  it('createUser：标识 seal 入库并写 cryptoId 与 HMAC 查找列（v10.0）', async () => {
    usersRepository.insert.mockResolvedValue(row());

    await service.createUser({
      email: 'A@Example.com',
      phone: null,
      passwordHash: 'hash',
      nickname: '测试用户',
    });

    // 邮箱取 normalizeIdentifier 归一化（小写）后 seal + hmac；手机号 null 直通
    expect(usersRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cryptoId: 'a'.repeat(32),
        email: 'v1.test.a@example.com',
        emailHmac: 'h:a@example.com',
        phone: null,
        phoneHmac: null,
      }),
      transaction,
    );

    usersRepository.insert.mockResolvedValue(row({ email: null, phone: '13800138000' }));
    await service.createUser({
      phone: '13800138000',
      passwordHash: 'hash',
      nickname: '测试用户',
    });
    // 手机号原样 seal + hmac
    expect(usersRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: null,
        emailHmac: null,
        phone: 'v1.test.13800138000',
        phoneHmac: 'h:13800138000',
      }),
      transaction,
    );
  });

  it('登录查找：identifier 归一化后按 HMAC 查找列精确匹配（v10.0）', async () => {
    usersRepository.findByEmailHmacOrPhoneHmac.mockResolvedValue(row());

    const record = await service.findByIdentifier('A@Example.com');

    expect(usersRepository.findByEmailHmacOrPhoneHmac).toHaveBeenCalledWith(
      'h:a@example.com',
      'h:a@example.com',
    );
    // UserAuthRecord 仍是明文视图（解密后）
    expect(record?.email).toBe('a@example.com');
  });

  it('换绑不能占用尚未回填的旧邮箱', async () => {
    usersRepository.findById.mockResolvedValue(row({ passwordHash: await hashPassword('password123') }));
    usersRepository.findIdentifierCandidates.mockResolvedValue([row({ id: 'other-user', email: 'old@example.com', emailHmac: null, cryptoId: null })]);
    await expect(service.changeIdentifier(row().id, { captchaId: 'captcha-1', captchaCode: 'ABCDE', type: 'email', value: ' OLD@example.com ', password: 'password123' })).rejects.toThrow(ConflictException);
    expect(usersRepository.updateIdentifier).not.toHaveBeenCalled();
  });

  it('换绑邮箱：核销邮件验证码后 seal + HMAC 更新并记验证时间，不清空手机号（v12.0）', async () => {
    usersRepository.findById.mockResolvedValue(
      row({ passwordHash: await hashPassword('password123') }),
    );
    usersRepository.findByEmailHmac.mockResolvedValue(null);
    usersRepository.updateIdentifier.mockResolvedValue(row());

    await service.changeIdentifier('01890a5d-ac96-7000-8000-000000000001', {
      captchaId: 'captcha-1',
      captchaCode: 'ABCDE',
      type: 'email',
      value: 'new@example.com',
      password: 'password123',
      emailCode: '123456',
    });

    // v12.0：换绑邮箱先按 purpose=rebind 一次性消费新邮箱的邮件验证码
    expect(emailCodeService.validate).toHaveBeenCalledWith('new@example.com', 'rebind', '123456');
    expect(usersRepository.updateIdentifier).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000001',
      expect.objectContaining({
        email: 'v1.test.new@example.com',
        emailHmac: 'h:new@example.com',
        emailVerifiedAt: expect.any(Date),
      }),
      transaction,
    );
    // v12.0 附加绑定：只更新当前类型字段，不触碰另一标识
    const patch = usersRepository.updateIdentifier.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('phone');
    expect(patch).not.toHaveProperty('phoneHmac');
  });

  it('换绑邮箱：邮件验证码校验失败 400 且不落库', async () => {
    usersRepository.findById.mockResolvedValue(
      row({ passwordHash: await hashPassword('password123') }),
    );
    emailCodeService.validate.mockRejectedValue(new BadRequestException('验证码错误或已失效'));

    await expect(
      service.changeIdentifier('01890a5d-ac96-7000-8000-000000000001', {
        captchaId: 'captcha-1',
        captchaCode: 'ABCDE',
        type: 'email',
        value: 'new@example.com',
        password: 'password123',
        emailCode: '000000',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersRepository.updateIdentifier).not.toHaveBeenCalled();
  });

  it('绑手机号：附加绑定只写 phone 字段，不清空邮箱、不验邮件码（v12.0）', async () => {
    usersRepository.findById.mockResolvedValue(
      row({ passwordHash: await hashPassword('password123') }),
    );
    usersRepository.updateIdentifier.mockResolvedValue(row({ phone: '13800138000' }));

    await service.changeIdentifier('01890a5d-ac96-7000-8000-000000000001', {
      captchaId: 'captcha-1',
      captchaCode: 'ABCDE',
      type: 'phone',
      value: '13800138000',
      password: 'password123',
    });

    expect(emailCodeService.validate).not.toHaveBeenCalled();
    const patch = usersRepository.updateIdentifier.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).toMatchObject({ phone: 'v1.test.13800138000', phoneHmac: 'h:13800138000' });
    expect(patch).not.toHaveProperty('email');
    expect(patch).not.toHaveProperty('emailHmac');
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
    expect(usersRepository.deleteById).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001', 'admin-actor');

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
    usersRepository.listExpiredVisitorIds.mockResolvedValue(['id-1', 'id-2']);
    usersRepository.deleteById.mockResolvedValue(row({ role: Role.VISITOR }));

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
        captchaId: 'captcha-1',
        captchaCode: 'ABCDE',
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

  it('剔除：purge 交给 deleteById 事务，service 写审计', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.VISITOR }));
    usersRepository.deleteById.mockResolvedValue(row({ role: Role.VISITOR }));

    await service.removeByAdmin('01890a5d-ac96-7000-8000-000000000001', actor);

    expect(usersRepository.deleteById).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001', 'admin-actor');
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
    usersRepository.findById.mockImplementation((id: string) => row({ id }));
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

  it('更新主页：资料字段（v9.0）超长/超量返回 400，写入走信封 seal（v10.0）', async () => {
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', { company: 'x'.repeat(101) }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', { link: 'x'.repeat(201) }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
        socials: ['a', 'b', 'c', 'd', 'e'],
      }),
    ).rejects.toThrow(BadRequestException);

    usersRepository.findById.mockResolvedValue(row());
    usersRepository.updateProfilePage.mockResolvedValue(row());
    await service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
      company: '沈阳工业大学',
      location: '辽宁沈阳',
      link: 'geminimortal.cn',
      socials: ['https://github.com/GeminiMortal', ''],
    });
    // 资料字段共用 'profile' 用途域 seal；socials 逐条 seal('social')，空串→null 条目原位保留
    expect(usersRepository.updateProfilePage).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001', {
      bio: undefined,
      profileReadme: undefined,
      pinnedItems: undefined,
      company: 'v1.test.沈阳工业大学',
      location: 'v1.test.辽宁沈阳',
      link: 'v1.test.geminimortal.cn',
      socials: ['v1.test.https://github.com/GeminiMortal', null],
    }, transaction);
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
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.updateProfilePage.mockResolvedValue(row());

    await service.updateProfilePage('01890a5d-ac96-7000-8000-000000000001', {
      pinnedItems: [{ type: 'ARTICLE', id: 'mine' }],
    });

    expect(usersRepository.updateProfilePage).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000001', {
      bio: undefined,
      profileReadme: undefined,
      pinnedItems: [{ type: 'ARTICLE', id: 'mine' }],
      company: undefined,
      location: undefined,
      link: undefined,
      socials: undefined,
    }, transaction);
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
          issueSlug: 'tao-lun-biao-ti',
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
      issueSlug: 'tao-lun-biao-ti',
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

  // ===== 关注 =====

  const targetId = '01890a5d-ac96-7000-8000-000000000001';

  it('关注：不能关注自己', async () => {
    usersRepository.findById.mockResolvedValue(row());
    await expect(service.follow(targetId, selfViewer)).rejects.toThrow(BadRequestException);
    expect(usersRepository.insertFollow).not.toHaveBeenCalled();
  });

  it('关注：VISITOR 403', async () => {
    usersRepository.findById.mockResolvedValue(row());
    await expect(service.follow(targetId, visitorViewer)).rejects.toThrow(ForbiddenException);
    expect(usersRepository.insertFollow).not.toHaveBeenCalled();
  });

  it('关注：新关注发一条通知，重复关注幂等不重复通知', async () => {
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.insertFollow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await service.follow(targetId, memberViewer);
    expect(first).toEqual({ following: true });
    expect(notificationsService.notifyUser).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyUser).toHaveBeenCalledWith(
      targetId,
      expect.objectContaining({ type: 'FOLLOW', link: '/users/testuser' }),
    );

    const second = await service.follow(targetId, memberViewer);
    expect(second).toEqual({ following: true });
    expect(notificationsService.notifyUser).toHaveBeenCalledTimes(1);
  });

  it('关注：目标封禁视为不存在', async () => {
    usersRepository.findById.mockResolvedValue(row({ status: UserStatus.BANNED }));
    await expect(service.follow(targetId, memberViewer)).rejects.toThrow(NotFoundException);
    expect(usersRepository.insertFollow).not.toHaveBeenCalled();
  });

  it('取关：幂等返回 following:false', async () => {
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.deleteFollow.mockResolvedValue(false);
    const result = await service.unfollow(targetId, memberViewer);
    expect(result).toEqual({ following: false });
  });

  it('关注列表：排除封禁由仓储保证，返回用户卡与关注态', async () => {
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.listFollowing.mockResolvedValue({ rows: [row({ id: 'u-2', username: 'bob' })], total: 1 });
    usersRepository.filterFollowedIds.mockResolvedValue(new Set(['u-2']));

    const result = await service.listFollowing(targetId, memberViewer, 1, 10);

    expect(result.items).toEqual([
      {
        id: 'u-2',
        username: 'bob',
        nickname: '测试用户',
        avatarUrl: null,
        role: Role.MEMBER,
        bio: null,
        isSelf: false,
        isFollowing: true,
      },
    ]);
    expect(result.total).toBe(1);
  });

  // ===== 用户名（handle） =====

  it('改用户名：格式非法 400，重复 409，成功返回 UserSelf', async () => {
    await expect(service.updateUsername(targetId, { username: 'a b' })).rejects.toThrow(
      BadRequestException,
    );
    usersRepository.usernameExists.mockResolvedValue(true);
    await expect(service.updateUsername(targetId, { username: 'taken' })).rejects.toThrow(
      ConflictException,
    );
    usersRepository.usernameExists.mockResolvedValue(false);
    usersRepository.updateUsername.mockResolvedValue(row({ username: 'new-name' }));
    const result = await service.updateUsername(targetId, { username: 'New-Name' });
    expect(result.username).toBe('new-name');
    expect(usersRepository.updateUsername).toHaveBeenCalledWith(targetId, 'new-name', 'testuser', transaction);
  });

  it('社区数据徽章：按用户名返回四类计数、近一年贡献与站内连击', async () => {
    const dayKey = (offset: number): string => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    usersRepository.findByUsername.mockResolvedValue(row());
    usersRepository.getProfileStats.mockResolvedValue({
      articles: 1,
      issues: 2,
      replies: 3,
      submissions: 4,
    });
    usersRepository.getActivityParts.mockResolvedValue({
      articles: [{ date: dayKey(0), count: 2 }],
      issues: [{ date: dayKey(0), count: 1 }],
      replies: [{ date: dayKey(1), count: 3 }],
      submissions: [],
      resources: [{ date: dayKey(2), count: 1 }],
    });

    const result = await service.getStatsBadges('gemini');

    expect(result).toEqual({
      articles: 1,
      issues: 2,
      replies: 3,
      submissions: 4,
      contributions: 7,
      streak: 3,
    });
    expect(usersRepository.getProfileStats).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000001',
    );
  });

  it('社区数据徽章：用户名不存在 404', async () => {
    usersRepository.findByUsername.mockResolvedValue(null);

    await expect(service.getStatsBadges('no-such-user')).rejects.toThrow(NotFoundException);
    expect(usersRepository.getProfileStats).not.toHaveBeenCalled();
  });

  it('站内连击：今天无贡献从昨天起算，中断则归零', () => {
    const today = new Date('2026-01-03T12:00:00.000Z');

    expect(
      computeStreak(
        [
          { date: '2026-01-01', count: 1 },
          { date: '2026-01-02', count: 2 },
        ],
        today,
      ),
    ).toBe(2);
    expect(
      computeStreak(
        [
          { date: '2026-01-02', count: 1 },
          { date: '2025-12-30', count: 5 },
        ],
        today,
      ),
    ).toBe(1);
    expect(computeStreak([{ date: '2026-01-03', count: 0 }], today)).toBe(0);
  });
  it('过期访客逐个使用事务 purge，角色已变化的账号不能误删', async () => {
    usersRepository.listExpiredVisitorIds.mockResolvedValue(['expired', 'promoted']);
    usersRepository.deleteById.mockResolvedValueOnce(row({ role: Role.VISITOR })).mockResolvedValueOnce(null);
    const count = await service.cleanupExpiredVisitors();
    expect(count).toBe(1);
    expect(usersRepository.deleteById).toHaveBeenCalledWith('expired', undefined, expect.any(Date));
    expect(refreshStore.revokeAll).toHaveBeenCalledTimes(1);
  });

  // ===== 通知邮件偏好与收件人（v12.0） =====

  it('通知偏好：按行返回开关，缺失用户默认关', async () => {
    usersRepository.findById.mockResolvedValue(row({ emailNoticeEnabled: true }));
    await expect(service.getNoticePref(targetId)).resolves.toEqual({ emailNoticeEnabled: true });

    usersRepository.findById.mockResolvedValue(null);
    await expect(service.getNoticePref(targetId)).resolves.toEqual({ emailNoticeEnabled: false });
  });

  it('通知偏好：更新成功返回开关，用户不存在 404', async () => {
    usersRepository.updateNoticePref.mockResolvedValue(row({ emailNoticeEnabled: true }));
    await expect(service.updateNoticePref(targetId, true)).resolves.toEqual({ emailNoticeEnabled: true });
    expect(usersRepository.updateNoticePref).toHaveBeenCalledWith(targetId, true);

    usersRepository.updateNoticePref.mockResolvedValue(null);
    await expect(service.updateNoticePref(targetId, false)).rejects.toThrow(NotFoundException);
  });

  it('通知收件人：仅 ACTIVE + 已验证 + 开关开入选，邮箱解密后返回', async () => {
    usersRepository.findByIds.mockResolvedValue([
      row({ id: 'u-ok', email: 'v1.test.a@example.com', emailNoticeEnabled: true, emailVerifiedAt: now }),
    ]);

    const result = await service.getMailRecipients(['u-ok']);

    expect(usersRepository.findByIds).toHaveBeenCalledWith(['u-ok']);
    // 邮箱在 users 模块内解密（openField），输出明文
    expect(result).toEqual([{ userId: 'u-ok', email: 'a@example.com', nickname: '测试用户' }]);
  });

  it('通知收件人：封禁 / 未验证 / 开关关 / 无邮箱均不入选', async () => {
    usersRepository.findByIds.mockResolvedValue([
      row({ id: 'u-banned', status: UserStatus.BANNED, emailNoticeEnabled: true, emailVerifiedAt: now }),
      row({ id: 'u-unverified', emailNoticeEnabled: true, emailVerifiedAt: null }),
      row({ id: 'u-off', emailNoticeEnabled: false, emailVerifiedAt: now }),
      row({ id: 'u-noemail', email: null, emailNoticeEnabled: true, emailVerifiedAt: now }),
      row({ id: 'u-ok', emailNoticeEnabled: true, emailVerifiedAt: now }),
    ]);

    const result = await service.getMailRecipients([
      'u-banned',
      'u-unverified',
      'u-off',
      'u-noemail',
      'u-ok',
    ]);

    expect(result.map((r) => r.userId)).toEqual(['u-ok']);
  });

  it('通知收件人：空 id 列表直接返回空数组，不查库', async () => {
    await expect(service.getMailRecipients([])).resolves.toEqual([]);
    expect(usersRepository.findByIds).not.toHaveBeenCalled();
  });

});

/** 信封加密（v10.0）：CryptoService 真实实现的往返、null 直通与拒绝语义 */
describe('CryptoService 信封往返与 null 直通（v10.0）', () => {
  const crypto = new CryptoService(Buffer.alloc(32, 7).toString('base64'));
  const cryptoId = crypto.newCryptoId();

  it('seal→open 往返还原明文，hmac 确定性且 64 位 hex', () => {
    const token = crypto.seal('email', 'A@Example.com', cryptoId);
    expect(token).toMatch(/^v1\./);
    expect(crypto.open('email', token, cryptoId)).toBe('A@Example.com');
    expect(crypto.hmac('a@example.com')).toBe(crypto.hmac('a@example.com'));
    expect(crypto.hmac('a@example.com')).toHaveLength(64);
  });

  it('null/空串直通：seal 返回 null，open 对空值与非信封值返回 null', () => {
    expect(crypto.seal('profile', null, cryptoId)).toBeNull();
    expect(crypto.seal('profile', '', cryptoId)).toBeNull();
    expect(crypto.open('profile', null, cryptoId)).toBeNull();
    expect(crypto.open('profile', '', cryptoId)).toBeNull();
    expect(crypto.open('profile', 'plain-text', cryptoId)).toBeNull();
  });

  it('跨用途/跨用户挪用/篡改密文一律拒绝返回 null', () => {
    const token = crypto.seal('email', 'a@example.com', cryptoId);
    if (!token) {
      throw new Error('seal 不应返回 null');
    }
    const parts = token.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    const corrupted = parts.join('.');
    expect(crypto.open('phone', token, cryptoId)).toBeNull();
    expect(crypto.open('email', token, crypto.newCryptoId())).toBeNull();
    expect(crypto.open('email', corrupted, cryptoId)).toBeNull();
  });
});

/** UpdateProfilePageDto.socials（v10.0 修复）：非字符串条目不再被静默丢弃 */
describe('UpdateProfilePageDto.socials 校验（v10.0 修复）', () => {
  it('非字符串条目保留并由 @IsString 报错（[123,null,\'ok\'] 拒绝）', async () => {
    const dto = plainToInstance(UpdateProfilePageDto, { socials: [123, null, 'ok'] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('字符串条目 trim 并剔除空串', async () => {
    const dto = plainToInstance(UpdateProfilePageDto, { socials: ['  a  ', '', '   ', 'b'] });
    expect(dto.socials).toEqual(['a', 'b']);
    expect(await validate(dto)).toEqual([]);
  });
});


describe('用户加密标识并发回归', () => {
  it('换绑等待期间资料已初始化 cryptoId，仍保留两边的可解密数据', async () => {
    const crypto = new CryptoService(Buffer.alloc(32, 7).toString('base64'));
    const initial = row({ cryptoId: null, passwordHash: await hashPassword('Password123') });
    const live = { ...initial };
    const id = crypto.newCryptoId();
    const repository = {
      findById: async () => ({ ...initial }),
      findIdentifierCandidates: async () => [],
      withUsernameLock: async (fn: (tx: typeof transaction) => Promise<unknown>) => {
        live.cryptoId = id;
        live.bio = crypto.seal('profile', 'saved bio', id);
        return fn(transaction);
      },
      withUserLock: async (_id: string, fn: (row: UserRow, tx: typeof transaction) => Promise<unknown>) => fn({ ...live }, transaction),
      updateIdentifier: async (_id: string, patch: Partial<UserRow>) => Object.assign(live, patch),
    };
    const service = new UsersService(repository as unknown as UsersRepository, crypto, {} as UploadsService, {} as NotificationsService, {} as AuditLogService, { validate: async () => {} } as unknown as CaptchaService, { validate: async () => {} } as unknown as EmailCodeService, {} as never);
    await service.changeIdentifier(live.id, { type: 'email', value: 'new@example.com', password: 'Password123', captchaId: 'c', captchaCode: 'c' });
    expect(live.cryptoId).toBe(id);
    expect(crypto.open('profile', live.bio, id)).toBe('saved bio');
    expect(crypto.open('email', live.email, id)).toBe('new@example.com');
  });

  it('两个并发资料保存共用第一次初始化的 cryptoId', async () => {
    const crypto = new CryptoService(Buffer.alloc(32, 7).toString('base64'));
    const live = row({ cryptoId: null });
    let queue = Promise.resolve();
    const repository = {
      withUserLock: (_id: string, fn: (row: UserRow, tx: typeof transaction) => Promise<unknown>) => {
        const result = queue.then(() => fn({ ...live }, transaction));
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
      updateProfilePage: async (_id: string, patch: Partial<UserRow>) => {
        for (const [key, value] of Object.entries(patch)) if (value !== undefined) Object.assign(live, { [key]: value });
        return { ...live };
      },
    };
    const service = new UsersService(repository as unknown as UsersRepository, crypto, {} as UploadsService, {} as NotificationsService, {} as AuditLogService, {} as CaptchaService, { validate: async () => {} } as unknown as EmailCodeService, {} as never);
    await Promise.all([service.updateProfilePage(live.id, { bio: 'bio' }), service.updateProfilePage(live.id, { company: 'company' })]);
    expect(crypto.open('profile', live.bio, live.cryptoId!)).toBe('bio');
    expect(crypto.open('profile', live.company, live.cryptoId!)).toBe('company');
  });
});
