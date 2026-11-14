/* 注册流程 e2e：邀请码分支（无码→VISITOR / 有码→MEMBER / 满员 / 作废 / 过期 / 无效）
   风格与 guards.e2e-spec 一致：真实 controller + service，仓储与外部依赖打桩 */
import { ConflictException, INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { appValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Role } from '../src/common/decorators/roles.decorator';
import { AppConfig, configuration } from '../src/config/configuration';
import { REDIS_CLIENT, REFRESH_TOKEN_STORE } from '../src/db/redis';
import { UserStatus } from '../src/db/schema';
import { AuditLogService } from '../src/modules/audit/audit-log.service';
import { LoginLogsService } from '../src/modules/audit/login-logs.service';
import { InviteCodesRepository } from '../src/modules/admin/invite-codes.repository';
import { InviteCodesService } from '../src/modules/admin/invite-codes.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { UsersService } from '../src/modules/users/users.service';

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

describe('注册流程（邀请码分支 e2e）', () => {
  let app: INestApplication;

  const usersService = {
    createUser: jest.fn(),
    findByIdentifier: jest.fn(),
    getAuthRecordById: jest.fn(),
    getAuthUser: jest.fn(),
    getSelf: jest.fn(),
  };
  const inviteCodesRepository = {
    insertMany: jest.fn(),
    findByCode: jest.fn(),
    findById: jest.fn(),
    list: jest.fn(),
    tryConsume: jest.fn(),
    release: jest.fn(),
    revoke: jest.fn(),
    countActive: jest.fn(),
  };
  const redis = {
    eval: jest.fn().mockResolvedValue(1),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
  };
  const refreshStore = {
    register: jest.fn(),
    rotate: jest.fn(),
    revokeAll: jest.fn(),
  };

  const selfFixture = {
    id: '01890a5d-ac96-7000-8000-000000000001',
    nickname: '测试用户',
    avatarUrl: null,
    role: Role.VISITOR,
    status: UserStatus.ACTIVE,
    email: 'a@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const codeRow = {
    id: '01890a5d-ac96-7000-8000-0000000000aa',
    code: 'ABCD2345EF',
    status: 'ACTIVE' as const,
    maxUses: 1,
    usedCount: 0,
    createdById: '01890a5d-ac96-7000-8000-000000000002',
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const registerBody = {
    identifier: 'a@example.com',
    password: 'password123',
    nickname: '测试用户',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        InviteCodesService,
        { provide: InviteCodesRepository, useValue: inviteCodesRepository },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: LoginLogsService, useValue: { record: jest.fn() } },
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: new JwtService({ secret: testConfig.jwtAccessSecret }) },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: REFRESH_TOKEN_STORE, useValue: refreshStore },
        { provide: configuration.KEY, useValue: testConfig },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(appValidationPipe);
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getAuthUser.mockResolvedValue({ id: selfFixture.id, role: selfFixture.role, status: UserStatus.ACTIVE, sessionVersion: 0 });
  });

  it('无码注册：创建 VISITOR 账号', async () => {
    usersService.createUser.mockResolvedValue(selfFixture);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerBody)
      .expect(201);

    expect(usersService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.VISITOR, inviteCodeId: null }),
    );
    expect(res.body.role).toBe(Role.VISITOR);
  });

  it('有码注册：核销邀请码并创建 MEMBER 账号', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue(codeRow);
    inviteCodesRepository.tryConsume.mockResolvedValue({ ...codeRow, usedCount: 1 });
    usersService.createUser.mockResolvedValue({ ...selfFixture, role: Role.MEMBER });

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'abcd2345ef' })
      .expect(201);

    expect(inviteCodesRepository.findByCode).toHaveBeenCalledWith('ABCD2345EF');
    expect(usersService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.MEMBER, inviteCodeId: codeRow.id }),
    );
    expect(res.body.role).toBe(Role.MEMBER);
  });

  it('满员码：409 且不落库', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue({ ...codeRow, usedCount: 1, maxUses: 1 });
    inviteCodesRepository.tryConsume.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'ABCD2345EF' })
      .expect(409);

    expect(res.body.message).toBe('邀请码已被用尽');
    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it('作废码：409', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue({ ...codeRow, status: 'REVOKED' });

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'ABCD2345EF' })
      .expect(409);

    expect(res.body.message).toBe('邀请码已作废');
  });

  it('过期码：409', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue({
      ...codeRow,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'ABCD2345EF' })
      .expect(409);

    expect(res.body.message).toBe('邀请码已过期');
  });

  it('无效码：409', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'NOPE2345XX' })
      .expect(409);

    expect(res.body.message).toBe('邀请码无效');
  });

  it('落库失败：回退核销计数', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue(codeRow);
    inviteCodesRepository.tryConsume.mockResolvedValue({ ...codeRow, usedCount: 1 });
    usersService.createUser.mockRejectedValue(new ConflictException('该邮箱或手机号已被注册'));

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'ABCD2345EF' })
      .expect(409);

    expect(inviteCodesRepository.release).toHaveBeenCalledWith(codeRow.id);
  });
});
