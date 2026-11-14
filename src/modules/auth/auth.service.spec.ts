import { ConflictException, ForbiddenException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppConfig, configuration } from '../../config/configuration';
import { Role } from '../../common/decorators/roles.decorator';
import { REDIS_CLIENT, REFRESH_TOKEN_STORE } from '../../db/redis';
import { UserStatus } from '../../db/schema';
import { InviteCodesService } from '../admin/invite-codes.service';
import { LoginLogsService } from '../audit/login-logs.service';
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: InviteCodesService, useValue: inviteCodesService },
        { provide: LoginLogsService, useValue: loginLogsService },
        { provide: JwtService, useValue: new JwtService({ secret: 'unit-test-secret' }) },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: REFRESH_TOKEN_STORE, useValue: refreshStore },
        { provide: configuration.KEY, useValue: testConfig },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
    usersService.getAuthUser.mockResolvedValue({ id: selfFixture.id, role: Role.MEMBER, status: UserStatus.ACTIVE, sessionVersion: 0 });
  });

  it('注册成功：邮箱标识落库并签发双 token', async () => {
    usersService.createUser.mockResolvedValue(selfFixture);

    const result = await service.register({
      identifier: 'A@Example.com',
      password: 'password123',
      nickname: '测试用户',
    });

    expect(usersService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@example.com', phone: null }),
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

  it('无码注册：创建 VISITOR 账号', async () => {
    usersService.createUser.mockResolvedValue({ ...selfFixture, role: Role.VISITOR });

    await service.register({
      identifier: 'a@example.com',
      password: 'password123',
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
      identifier: 'a@example.com',
      password: 'password123',
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
        identifier: 'a@example.com',
        password: 'password123',
        nickname: '测试用户',
        inviteCode: 'FULL2345CD',
      }),
    ).rejects.toThrow(ConflictException);
    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it('注册落库失败：回退核销计数', async () => {
    inviteCodesService.consume.mockResolvedValue({ id: 'invite-1' });
    usersService.createUser.mockRejectedValue(new ConflictException('该邮箱或手机号已被注册'));

    await expect(
      service.register({
        identifier: 'a@example.com',
        password: 'password123',
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

    const result = await service.redeemInviteCode(selfFixture.id, { inviteCode: 'ABCD2345EF' });

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
      service.redeemInviteCode(selfFixture.id, { inviteCode: 'ABCD2345EF' }),
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
      service.redeemInviteCode(selfFixture.id, { inviteCode: 'FULL2345CD' }),
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
      service.login({ identifier: 'a@example.com', password: 'wrong-password' }, '127.0.0.1'),
    ).rejects.toThrow('账号或密码错误');
    await expect(
      service.login({ identifier: 'a@example.com', password: 'wrong-password' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('登录限流：15 分钟内失败 5 次后返回 429', async () => {
    redis.get.mockResolvedValue('5');

    await expect(
      service.login({ identifier: 'a@example.com', password: 'whatever' }, '127.0.0.1'),
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
        currentPassword: 'wrong-password',
        newPassword: 'newpassword123',
      }),
    ).rejects.toThrow(HttpException);
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
      { identifier: 'a@example.com', password: 'password123' },
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
      service.login({ identifier: 'a@example.com', password: 'wrong-password' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
    expect(loginLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, success: false, failReason: '密码错误' }),
    );

    usersService.findByIdentifier.mockResolvedValue(null);
    await expect(
      service.login({ identifier: 'nobody@example.com', password: 'whatever' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
    expect(loginLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, success: false, failReason: '用户不存在' }),
    );
  });

  it('登录限流也写登录日志', async () => {
    redis.get.mockResolvedValue('5');

    await expect(
      service.login({ identifier: 'a@example.com', password: 'whatever' }, '127.0.0.1'),
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
});
