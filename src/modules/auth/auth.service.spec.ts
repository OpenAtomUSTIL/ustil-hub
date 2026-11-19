import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppConfig, configuration } from '../../config/configuration';
import { Role } from '../../common/decorators/roles.decorator';
import { CryptoService } from '../../common/crypto/crypto.service';
import { REDIS_CLIENT, REFRESH_TOKEN_STORE } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { InviteCodesService } from '../admin/invite-codes.service';
import { LoginLogsService } from '../audit/login-logs.service';
import { CaptchaService } from '../captcha/captcha.service';
import { EmailCodeService } from '../mail/email-code.service';
import { signUnsubscribeToken } from '../mail/link-tokens';
import { RESET_TOKEN_STORE } from '../mail/mail.module';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { UserSelf } from '../users/users.views';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  trustProxyHops: 0,
  corsOrigin: 'http://localhost:5173',
  databaseUrl: 'postgres://test',
  redisUrl: 'redis://test',
  jwtAccessSecret: 'test-access-secret-0123456789',
  jwtRefreshSecret: 'test-refresh-secret-0123456789',
  storage: {
    driver: 'local',
    localDir: './storage',
    r2: {
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: '',
      publicBaseUrl: '',
    },
  },
  uploadMaxSize: 10485760,
  mail: {
    driver: 'none',
    from: '',
    linkBase: 'https://forum.openatomustil.cn',
    templateIds: {
      'verify-code': 0,
      'reset-password': 0,
      'notice-reply': 0,
      'notice-generic': 0,
    },
    api: { secretId: '', secretKey: '', region: 'ap-guangzhou' },
    smtp: { host: '', port: 465, user: '', pass: '' },
  },
};

const selfFixture: UserSelf = {
  id: '01890a5d-ac96-7000-8000-000000000001',
  username: 'testuser',
  nickname: '测试用户',
  avatarUrl: null,
  role: Role.MEMBER,
  status: UserStatus.ACTIVE,
  email: 'a@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  // 敏感操作 DTO 自 v6.0 起必带图形验证码字段（service 内 captchaService.validate 打桩放行）
  const captchaFields = { captchaId: 'captcha-1', captchaCode: 'ABCDE' };

  const usersService = {
    createUser: jest.fn(),
    findByIdentifier: jest.fn(),
    getAuthRecordById: jest.fn(),
    updatePasswordHash: jest.fn(),
    getSelf: jest.fn(),
    getPublic: jest.fn(),
    getAuthUser: jest.fn(),
    applyInviteCode: jest.fn(),
    invalidateSessions: jest.fn(),
    updateNoticePref: jest.fn(),
  };
  const inviteCodesService = {
    consume: jest.fn(),
    release: jest.fn(),
    generate: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
  };
  const redis = {
    eval: jest.fn().mockResolvedValue(1),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    scan: jest.fn(),
  };
  const refreshStore = {
    register: jest.fn(),
    rotate: jest.fn(),
    revokeAll: jest.fn(),
  };
  const loginLogsService = {
    record: jest.fn(),
  };
  const captchaService = {
    validate: jest.fn(),
    create: jest.fn(),
  };
  // v12.0 事务邮件：验证码 / 发信 / 一次性重置 token / CryptoService（退订 token HMAC）
  const emailCodeService = {
    check: jest.fn(),
    validate: jest.fn(),
    issue: jest.fn(),
  };
  const mailService = {
    send: jest.fn(),
    driver: 'none',
  };
  const cryptoStub = {
    hmac: (plaintext: string): string => 'h:' + plaintext,
    hmacEquals: (a: string, b: string): boolean => a === b,
  };
  const resetTokens = {
    issue: jest.fn(),
    consume: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // clearAllMocks 不清实现，逐个复位避免用例间互相污染
    captchaService.validate.mockReset();
    emailCodeService.validate.mockReset();
    emailCodeService.check.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: InviteCodesService, useValue: inviteCodesService },
        { provide: LoginLogsService, useValue: loginLogsService },
        { provide: CaptchaService, useValue: captchaService },
        { provide: JwtService, useValue: new JwtService({ secret: 'unit-test-secret' }) },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: REFRESH_TOKEN_STORE, useValue: refreshStore },
        { provide: RESET_TOKEN_STORE, useValue: resetTokens },
        { provide: EmailCodeService, useValue: emailCodeService },
        { provide: MailService, useValue: mailService },
        { provide: CryptoService, useValue: cryptoStub },
        { provide: configuration.KEY, useValue: testConfig },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
    usersService.getAuthUser.mockResolvedValue({ id: selfFixture.id, role: Role.MEMBER, status: UserStatus.ACTIVE, sessionVersion: 0 });
  });

  it('注册成功：仅邮箱注册，邮件验证码核销后落库（emailVerifiedAt）并签发双 token', async () => {
    usersService.createUser.mockResolvedValue(selfFixture);

    const result = await service.register({
      ...captchaFields,
      identifier: 'A@Example.com',
      emailCode: '123456',
      password: 'password123',
      passwordConfirm: 'password123',
      nickname: '测试用户',
    });

    // v12.0：identifier 归一化后按 purpose=register 一次性消费邮件验证码
    expect(emailCodeService.validate).toHaveBeenCalledWith('a@example.com', 'register', '123456');
    expect(usersService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@example.com',
        phone: null,
        emailVerifiedAt: expect.any(Date),
      }),
    );
    expect(result.user.id).toBe(selfFixture.id);
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(refreshStore.register).toHaveBeenCalledWith(
      selfFixture.id,
      expect.any(String),
      7 * 24 * 3600,
    );
  });

  it('注册：邮件验证码校验失败 400 且不落库', async () => {
    emailCodeService.check.mockRejectedValue(new BadRequestException('验证码错误或已失效'));

    await expect(
      service.register({
        ...captchaFields,
        identifier: 'a@example.com',
        emailCode: '000000',
        password: 'password123',
        passwordConfirm: 'password123',
        nickname: '测试用户',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersService.createUser).not.toHaveBeenCalled();
    expect(inviteCodesService.consume).not.toHaveBeenCalled();
  });

  it('无码注册：创建 VISITOR 账号', async () => {
    usersService.createUser.mockResolvedValue({ ...selfFixture, role: Role.VISITOR });

    await service.register({
      ...captchaFields,
      identifier: 'a@example.com',
      emailCode: '123456',
      password: 'password123',
      passwordConfirm: 'password123',
      nickname: '测试用户',
    });

    expect(inviteCodesService.consume).not.toHaveBeenCalled();
    expect(usersService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.VISITOR, inviteCodeId: null }),
    );
  });

  it('有码注册：核销邀请码并创建 MEMBER 账号', async () => {
    inviteCodesService.consume.mockResolvedValue({ id: 'invite-1' });
    usersService.createUser.mockResolvedValue(selfFixture);

    await service.register({
      ...captchaFields,
      identifier: 'a@example.com',
      emailCode: '123456',
      password: 'password123',
      passwordConfirm: 'password123',
      nickname: '测试用户',
      inviteCode: 'ABCD2345EF',
    });

    expect(inviteCodesService.consume).toHaveBeenCalledWith('ABCD2345EF');
    expect(usersService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.MEMBER, inviteCodeId: 'invite-1' }),
    );
    expect(inviteCodesService.release).not.toHaveBeenCalled();
  });

  it('邀请码无效：409 且不落库', async () => {
    inviteCodesService.consume.mockRejectedValue(new ConflictException('邀请码已被用尽'));

    await expect(
      service.register({
        ...captchaFields,
        identifier: 'a@example.com',
        emailCode: '123456',
        password: 'password123',
        passwordConfirm: 'password123',
        nickname: '测试用户',
        inviteCode: 'FULL2345CD',
      }),
    ).rejects.toThrow(ConflictException);
    expect(usersService.createUser).not.toHaveBeenCalled();
    expect(emailCodeService.validate).not.toHaveBeenCalled();
  });

  it('注册落库失败：回退核销计数', async () => {
    inviteCodesService.consume.mockResolvedValue({ id: 'invite-1' });
    usersService.createUser.mockRejectedValue(new ConflictException('该邮箱已被注册'));

    await expect(
      service.register({
        ...captchaFields,
        identifier: 'a@example.com',
        emailCode: '123456',
        password: 'password123',
        passwordConfirm: 'password123',
        nickname: '测试用户',
        inviteCode: 'ABCD2345EF',
      }),
    ).rejects.toThrow(ConflictException);
    expect(inviteCodesService.release).toHaveBeenCalledWith('invite-1');
  });

  it('持码转正：VISITOR 核销邀请码升为 MEMBER 并换发 token', async () => {
    usersService.getAuthUser.mockResolvedValue({
      id: selfFixture.id,
      role: Role.VISITOR,
      status: UserStatus.ACTIVE,
      sessionVersion: 0,
    });
    inviteCodesService.consume.mockResolvedValue({ id: 'invite-1' });
    usersService.applyInviteCode.mockResolvedValue(selfFixture);

    const result = await service.redeemInviteCode(selfFixture.id, { ...captchaFields, inviteCode: 'ABCD2345EF' });

    expect(inviteCodesService.consume).toHaveBeenCalledWith('ABCD2345EF');
    expect(usersService.applyInviteCode).toHaveBeenCalledWith(selfFixture.id, 'invite-1');
    expect(refreshStore.revokeAll).toHaveBeenCalledWith(selfFixture.id);
    expect(result.tokens.accessToken).toBeTruthy();
  });

  it('持码转正：非 VISITOR 返回 403', async () => {
    usersService.getAuthUser.mockResolvedValue({
      id: selfFixture.id,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      sessionVersion: 0,
    });

    await expect(
      service.redeemInviteCode(selfFixture.id, { ...captchaFields, inviteCode: 'ABCD2345EF' }),
    ).rejects.toThrow(ForbiddenException);
    expect(inviteCodesService.consume).not.toHaveBeenCalled();
  });

  it('持码转正：邀请码无效 409 且不改角色', async () => {
    usersService.getAuthUser.mockResolvedValue({
      id: selfFixture.id,
      role: Role.VISITOR,
      status: UserStatus.ACTIVE,
      sessionVersion: 0,
    });
    inviteCodesService.consume.mockRejectedValue(new ConflictException('邀请码已被用尽'));

    await expect(
      service.redeemInviteCode(selfFixture.id, { ...captchaFields, inviteCode: 'FULL2345CD' }),
    ).rejects.toThrow(ConflictException);
    expect(usersService.applyInviteCode).not.toHaveBeenCalled();
  });

  it('登录失败（密码错误）：统一返回“账号或密码错误”', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: selfFixture.id,
      email: 'a@example.com',
      phone: null,
      passwordHash: await hashPassword('password123'),
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    redis.get.mockResolvedValue('0');
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);

    await expect(
      service.login({ ...captchaFields, identifier: 'a@example.com', password: 'wrong-password' }, '127.0.0.1'),
    ).rejects.toThrow('账号或密码错误');
    await expect(
      service.login({ ...captchaFields, identifier: 'a@example.com', password: 'wrong-password' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('登录限流：15 分钟内失败 5 次后返回 429', async () => {
    redis.get.mockResolvedValue('5');

    await expect(
      service.login({ ...captchaFields, identifier: 'a@example.com', password: 'whatever' }, '127.0.0.1'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('refresh jti 复用：清空该用户全部 refresh 并拒绝', async () => {
    const token = jwtService.sign(
      { sub: selfFixture.id, jti: 'jti-old', sessionVersion: 0 },
      { secret: testConfig.jwtRefreshSecret, expiresIn: 60 },
    );
    refreshStore.rotate.mockResolvedValue(false);

    await expect(service.refresh(token)).rejects.toThrow(UnauthorizedException);
    expect(usersService.invalidateSessions).toHaveBeenCalledWith(selfFixture.id, 0);
    expect(refreshStore.register).not.toHaveBeenCalled();
  });

  it('refresh 成功：轮换 jti 并只返回脱敏公开字段（不泄露 email/phone）', async () => {
    const token = jwtService.sign(
      { sub: selfFixture.id, jti: 'jti-old', sessionVersion: 0 },
      { secret: testConfig.jwtRefreshSecret, expiresIn: 60 },
    );
    refreshStore.rotate.mockResolvedValue(true);
    usersService.getPublic.mockResolvedValue({
      id: selfFixture.id,
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
    });

    const result = await service.refresh(token);

    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(refreshStore.rotate).toHaveBeenCalledWith(
      selfFixture.id,
      'jti-old',
      expect.any(String),
      7 * 24 * 3600,
    );
    expect(result.user).toEqual({
      id: selfFixture.id,
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
    });
    expect(result.user).not.toHaveProperty('email');
    expect(result.user).not.toHaveProperty('phone');
    expect(usersService.getSelf).not.toHaveBeenCalled();
  });

  it('改密码：当前密码错误返回 400', async () => {
    usersService.getAuthRecordById.mockResolvedValue({
      id: selfFixture.id,
      email: 'a@example.com',
      phone: null,
      passwordHash: await hashPassword('password123'),
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.changePassword(selfFixture.id, {
        ...captchaFields,
        currentPassword: 'wrong-password',
        newPassword: 'newpassword123',
        emailCode: '123456',
      }),
    ).rejects.toThrow(HttpException);
    // 密码错误发生在邮件码校验之前，不消耗验证码
    expect(emailCodeService.check).not.toHaveBeenCalled();
    expect(emailCodeService.validate).not.toHaveBeenCalled();
  });

  it('改密码：需当前绑定邮箱的邮件验证码（purpose=password）并全会话失效', async () => {
    usersService.getAuthRecordById.mockResolvedValue({
      id: selfFixture.id,
      email: 'a@example.com',
      phone: null,
      passwordHash: await hashPassword('password123'),
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    usersService.getSelf.mockResolvedValue(selfFixture);

    await service.changePassword(selfFixture.id, {
      ...captchaFields,
      currentPassword: 'password123',
      newPassword: 'newpassword123',
      emailCode: '123456',
    });

    expect(emailCodeService.check).toHaveBeenCalledWith('a@example.com', 'password', '123456');
    expect(emailCodeService.validate).toHaveBeenCalledWith('a@example.com', 'password', '123456');
    expect(usersService.updatePasswordHash).toHaveBeenCalledWith(selfFixture.id, expect.any(String));
    expect(refreshStore.revokeAll).toHaveBeenCalledWith(selfFixture.id);
  });

  it('改密码：邮件验证码错误返回 400 且不落库', async () => {
    usersService.getAuthRecordById.mockResolvedValue({
      id: selfFixture.id,
      email: 'a@example.com',
      phone: null,
      passwordHash: await hashPassword('password123'),
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    usersService.getSelf.mockResolvedValue(selfFixture);
    emailCodeService.check.mockRejectedValue(new HttpException('验证码错误或已失效', HttpStatus.BAD_REQUEST));

    await expect(
      service.changePassword(selfFixture.id, {
        ...captchaFields,
        currentPassword: 'password123',
        newPassword: 'newpassword123',
        emailCode: '000000',
      }),
    ).rejects.toThrow(HttpException);
    expect(emailCodeService.validate).not.toHaveBeenCalled();
    expect(usersService.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('改密码：账号未绑定邮箱返回 400', async () => {
    usersService.getAuthRecordById.mockResolvedValue({
      id: selfFixture.id,
      email: null,
      phone: '13800000000',
      passwordHash: await hashPassword('password123'),
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    usersService.getSelf.mockResolvedValue({ ...selfFixture, email: undefined });

    await expect(
      service.changePassword(selfFixture.id, {
        ...captchaFields,
        currentPassword: 'password123',
        newPassword: 'newpassword123',
        emailCode: '123456',
      }),
    ).rejects.toThrow('该账号未绑定邮箱');
    expect(emailCodeService.check).not.toHaveBeenCalled();
    expect(usersService.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('登录成功写登录日志（含 user_id，不落密码）', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: selfFixture.id,
      email: 'a@example.com',
      phone: null,
      passwordHash: await hashPassword('password123'),
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    usersService.getSelf.mockResolvedValue(selfFixture);
    redis.get.mockResolvedValue('0');

    await service.login(
      { ...captchaFields, identifier: 'a@example.com', password: 'password123' },
      '127.0.0.1',
      'jest-agent',
    );

    expect(loginLogsService.record).toHaveBeenCalledWith({
      userId: selfFixture.id,
      email: 'a@example.com',
      ip: '127.0.0.1',
      userAgent: 'jest-agent',
      success: true,
      failReason: null,
    });
  });

  it('登录失败写登录日志：密码错误 / 用户不存在，user_id 为空', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: selfFixture.id,
      email: 'a@example.com',
      phone: null,
      passwordHash: await hashPassword('password123'),
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    redis.get.mockResolvedValue('0');
    redis.incr.mockResolvedValue(1);

    await expect(
      service.login({ ...captchaFields, identifier: 'a@example.com', password: 'wrong-password' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
    expect(loginLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, success: false, failReason: '密码错误' }),
    );

    usersService.findByIdentifier.mockResolvedValue(null);
    await expect(
      service.login({ ...captchaFields, identifier: 'nobody@example.com', password: 'whatever' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
    expect(loginLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, success: false, failReason: '用户不存在' }),
    );
  });

  it('登录限流也写登录日志', async () => {
    redis.get.mockResolvedValue('5');

    await expect(
      service.login({ ...captchaFields, identifier: 'a@example.com', password: 'whatever' }, '127.0.0.1'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(loginLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, failReason: '登录尝试过于频繁' }),
    );
  });

  it('登出成功写登录日志', async () => {
    const token = jwtService.sign(
      { sub: selfFixture.id, jti: 'jti-logout', sessionVersion: 0 },
      { secret: testConfig.jwtRefreshSecret, expiresIn: 60 },
    );
    usersService.getAuthRecordById.mockResolvedValue({
      id: selfFixture.id,
      email: 'a@example.com',
      phone: null,
      passwordHash: 'x',
      nickname: '测试用户',
      avatarUrl: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      sessionVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.logout(token, '127.0.0.1', 'jest-agent');

    expect(usersService.invalidateSessions).toHaveBeenCalledWith(selfFixture.id, 0);
    expect(loginLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: selfFixture.id, email: 'a@example.com', success: true }),
    );
  });

  // ===== 事务邮件（v12.0）=====

  it('拉取邮件验证码：图形验证码通过后调用 issue（邮箱归一化）', async () => {
    await service.sendEmailCode({ email: 'A@Example.com', purpose: 'register', ...captchaFields });

    expect(emailCodeService.issue).toHaveBeenCalledWith('a@example.com', 'register');
  });

  it('拉取邮件验证码：图形验证码失败不发码', async () => {
    captchaService.validate.mockRejectedValue(new BadRequestException('验证码错误或已失效'));

    await expect(
      service.sendEmailCode({ email: 'a@example.com', purpose: 'register', ...captchaFields }),
    ).rejects.toThrow(BadRequestException);
    expect(emailCodeService.issue).not.toHaveBeenCalled();
  });

  it('忘记密码：账号存在则签发一次性 token 并发 reset-password 邮件', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: selfFixture.id,
      status: UserStatus.ACTIVE,
    });
    resetTokens.issue.mockResolvedValue('reset-token-1');

    await service.requestPasswordReset({ identifier: 'A@Example.com', ...captchaFields });

    expect(resetTokens.issue).toHaveBeenCalledWith(selfFixture.id);
    expect(mailService.send).toHaveBeenCalledWith('a@example.com', 'reset-password', {
      resetPath: 'reset-password?token=reset-token-1',
      expiresMinutes: '30',
    });
  });

  it('忘记密码：账号不存在静默返回（防账号枚举）', async () => {
    usersService.findByIdentifier.mockResolvedValue(null);

    await expect(
      service.requestPasswordReset({ identifier: 'nobody@example.com', ...captchaFields }),
    ).resolves.toBeUndefined();
    expect(resetTokens.issue).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('忘记密码：封禁账号静默不发信', async () => {
    usersService.findByIdentifier.mockResolvedValue({
      id: selfFixture.id,
      status: UserStatus.BANNED,
    });

    await expect(
      service.requestPasswordReset({ identifier: 'a@example.com', ...captchaFields }),
    ).resolves.toBeUndefined();
    expect(resetTokens.issue).not.toHaveBeenCalled();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('重置密码：消费一次性 token 更新密码并吊销全部会话', async () => {
    resetTokens.consume.mockResolvedValue(selfFixture.id);
    usersService.getAuthRecordById.mockResolvedValue({
      id: selfFixture.id,
      status: UserStatus.ACTIVE,
      passwordHash: await hashPassword('password123'),
    });

    await service.resetPassword({
      token: 'reset-token-1',
      newPassword: 'newPassword123',
      newPasswordConfirm: 'newPassword123',
    });

    expect(resetTokens.consume).toHaveBeenCalledWith('reset-token-1');
    expect(usersService.updatePasswordHash).toHaveBeenCalledWith(selfFixture.id, expect.any(String));
    expect(refreshStore.revokeAll).toHaveBeenCalledWith(selfFixture.id);
  });

  it('重置密码：无效 token 400 且不改密码', async () => {
    resetTokens.consume.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        token: 'bad-token',
        newPassword: 'newPassword123',
        newPasswordConfirm: 'newPassword123',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(usersService.updatePasswordHash).not.toHaveBeenCalled();
    expect(refreshStore.revokeAll).not.toHaveBeenCalled();
  });

  it('一键退订：有效 token 关闭邮件通知', async () => {
    const token = signUnsubscribeToken(cryptoStub as unknown as CryptoService, selfFixture.id);

    await service.unsubscribe({ token });

    expect(usersService.updateNoticePref).toHaveBeenCalledWith(selfFixture.id, false);
  });

  it('一键退订：无效 token 400 且不改偏好', async () => {
    await expect(service.unsubscribe({ token: 'bad.token.here' })).rejects.toThrow(
      BadRequestException,
    );
    expect(usersService.updateNoticePref).not.toHaveBeenCalled();
  });
  it.each([null, { id: selfFixture.id, status: UserStatus.BANNED }])('重置链接对应账号已删除或封禁时拒绝修改：%j', async (record) => {
    resetTokens.consume.mockResolvedValue(selfFixture.id);
    usersService.getAuthRecordById.mockResolvedValue(record);
    await expect(service.resetPassword({ token: 'token', newPassword: 'NewPassword123', newPasswordConfirm: 'NewPassword123' })).rejects.toThrow(BadRequestException);
    expect(usersService.updatePasswordHash).not.toHaveBeenCalled();
  });
  it('退订链接对应账号已删除时统一返回无效链接', async () => {
    usersService.updateNoticePref.mockRejectedValueOnce(new NotFoundException());
    const token = signUnsubscribeToken(cryptoStub as unknown as CryptoService, selfFixture.id);
    await expect(service.unsubscribe({ token })).rejects.toThrow('链接无效或已过期');
  });

});
