import * as captchaImage from '../src/modules/captcha/captcha-image';
/* 注册 / 登录 / 改密 / 换绑 / 转正 e2e（邀请码分支 + v6.0 验证码与密码规则）
   风格与 guards.e2e-spec 一致：真实 controller + service，仓储与外部依赖打桩；
   REDIS_CLIENT 用 FakeRedis 真模拟 captcha Lua 语义（比对哈希→命中即焚/失败限次） */
import { ConflictException, INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { appValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { CRYPTO_MASTER_KEY, CryptoService } from '../src/common/crypto/crypto.service';
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
import { hashPassword } from '../src/modules/auth/password';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { CaptchaController } from '../src/modules/captcha/captcha.controller';
import { CaptchaService } from '../src/modules/captcha/captcha.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { TagsService } from '../src/modules/tags/tags.service';
import { UploadsService } from '../src/modules/storage/uploads.service';
import { SnakeService } from '../src/modules/users/snake.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersRepository, UserRow } from '../src/modules/users/users.repository';
import { UsersService } from '../src/modules/users/users.service';
import { FakeRedis } from './fake-redis';

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

/** 32 字节 base64 测试主密钥（仅测试进程使用；格式同 .env.example 的 APP_ENCRYPTION_KEY） */
const TEST_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const testCrypto = new CryptoService(TEST_ENCRYPTION_KEY);
/** 固定 cryptoId（32 hex），便于断言信封 token 与 HMAC 查找列 */
const SELF_CRYPTO_ID = 'aa11bb22cc33dd44ee55ff6677889900';

const SELF_ID = '01890a5d-ac96-7000-8000-000000000001';

describe('敏感操作验证码 + 注册流程（邀请码分支 e2e）', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let fakeRedis: FakeRedis;
  let passwordHash: string;

  const usersRepository = {
    withUsernameLock: jest.fn(),
    withUserLock: jest.fn(),
    usernameExists: jest.fn(),
    insert: jest.fn(),
    findIdentifierCandidates: jest.fn(),
    findById: jest.fn(),
    findByUsername: jest.fn(),
    findByEmailHmacOrPhoneHmac: jest.fn(),
    findByEmailHmac: jest.fn(),
    findByPhoneHmac: jest.fn(),
    applyInviteCode: jest.fn(),
    updateIdentifier: jest.fn(),
    updatePasswordHash: jest.fn(),
    invalidateSessions: jest.fn(),
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
  const refreshStore = {
    register: jest.fn(),
    rotate: jest.fn(),
    revokeAll: jest.fn(),
  };

  /** 构造 users 行桩数据：入参 email/phone 为明文，落库形态为信封 token + HMAC 查找列（v10.0） */
  function row(overrides: Partial<UserRow> = {}): UserRow {
    const { email, phone, ...rest } = overrides;
    const cryptoId = overrides.cryptoId ?? SELF_CRYPTO_ID;
    const emailValue = email === undefined ? 'a@example.com' : email;
    const phoneValue = phone === undefined ? null : phone;
    return {
      id: SELF_ID,
      cryptoId,
      email: emailValue ? testCrypto.seal('email', emailValue, cryptoId) : null,
      emailHmac: emailValue ? testCrypto.hmac(emailValue) : null,
      phone: phoneValue ? testCrypto.seal('phone', phoneValue, cryptoId) : null,
      phoneHmac: phoneValue ? testCrypto.hmac(phoneValue) : null,
      passwordHash,
      nickname: '测试用户',
      username: 'testuser',
      avatarUrl: null,
      bio: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      sessionVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...rest,
    } as UserRow;
  }

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
    passwordConfirm: 'password123',
    nickname: '测试用户',
  };

  /** 真实生成与校验链路；仅在测试进程固定随机答案，不从响应中读取。 */
  async function captchaOf(): Promise<{ captchaId: string; captchaCode: string }> {
    const res = await request(app.getHttpServer()).get('/auth/captcha').expect(200);
    return { captchaId: res.body.captchaId, captchaCode: 'ABCDE' };
  }

  const tokenFor = (role: Role): string =>
    jwtService.sign(
      { sub: SELF_ID, role, sessionVersion: 0 },
      { secret: testConfig.jwtAccessSecret, expiresIn: 60 },
    );

  beforeAll(async () => {
    jest.spyOn(captchaImage, 'randomCaptchaCode').mockReturnValue('ABCDE');
    passwordHash = await hashPassword('password123');
    fakeRedis = new FakeRedis();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, CaptchaController, UsersController],
      providers: [
        AuthService,
        CaptchaService,
        UsersService,
        InviteCodesService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: InviteCodesRepository, useValue: inviteCodesRepository },
        { provide: CRYPTO_MASTER_KEY, useValue: TEST_ENCRYPTION_KEY },
        CryptoService,
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: LoginLogsService, useValue: { record: jest.fn() } },
        { provide: UploadsService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: TagsService, useValue: {} },
        { provide: SnakeService, useValue: {} },
        { provide: JwtService, useValue: new JwtService({ secret: testConfig.jwtAccessSecret }) },
        { provide: REDIS_CLIENT, useValue: fakeRedis },
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
    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fakeRedis.clear();
    usersRepository.withUsernameLock.mockImplementation((operation) => operation({}));
    usersRepository.withUserLock.mockImplementation(async (id, operation) => operation(await usersRepository.findById(id), {}));
    usersRepository.usernameExists.mockResolvedValue(false);
    usersRepository.insert.mockResolvedValue(row());
    usersRepository.findById.mockResolvedValue(row());
    usersRepository.findByUsername.mockResolvedValue(null);
    usersRepository.findByEmailHmacOrPhoneHmac.mockResolvedValue(null);
    usersRepository.findByEmailHmac.mockResolvedValue(null);
    usersRepository.findIdentifierCandidates.mockResolvedValue([]);
    usersRepository.findByPhoneHmac.mockResolvedValue(null);
  });

  // ===== 邀请码分支（既有用例，已补验证码字段） =====

  it('无码注册：创建 VISITOR 账号', async () => {
    usersRepository.insert.mockResolvedValue(row({ role: Role.VISITOR }));

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, ...(await captchaOf()) })
      .expect(201);

    expect(usersRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: Role.VISITOR,
        inviteCodeId: null,
        // v10.0：email 存信封 token（非明文），精确查走 HMAC 列
        email: expect.stringMatching(/^v1\./),
        emailHmac: testCrypto.hmac('a@example.com'),
        phoneHmac: null,
        cryptoId: expect.stringMatching(/^[0-9a-f]{32}$/),
      }),
      expect.anything(),
    );
    expect(res.body.role).toBe(Role.VISITOR);
  });

  it.each(['a@example.com', ' A@Example.com '])('旧账号尚未回填也拒绝重复邮箱注册：%s', async (email) => {
    usersRepository.findIdentifierCandidates.mockResolvedValue([{ ...row(), email, emailHmac: null, cryptoId: null }]);
    const res = await request(app.getHttpServer()).post('/auth/register')
      .send({ ...registerBody, ...(await captchaOf()) }).expect(409);
    expect(res.body.message).toBe('该邮箱或手机号已被注册');
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('缺失 HMAC 的加密邮箱也不能重复注册', async () => {
    usersRepository.findIdentifierCandidates.mockResolvedValue([row({ emailHmac: null })]);
    await request(app.getHttpServer()).post('/auth/register')
      .send({ ...registerBody, ...(await captchaOf()) }).expect(409);
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('有码注册：核销邀请码并创建 MEMBER 账号', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue(codeRow);
    inviteCodesRepository.tryConsume.mockResolvedValue({ ...codeRow, usedCount: 1 });
    usersRepository.insert.mockResolvedValue(row({ role: Role.MEMBER }));

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'abcd2345ef', ...(await captchaOf()) })
      .expect(201);

    expect(inviteCodesRepository.findByCode).toHaveBeenCalledWith('ABCD2345EF');
    expect(usersRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.MEMBER, inviteCodeId: codeRow.id }),
      expect.anything(),
    );
    expect(res.body.role).toBe(Role.MEMBER);
  });

  it('满员码：409 且不落库', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue({ ...codeRow, usedCount: 1, maxUses: 1 });
    inviteCodesRepository.tryConsume.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'ABCD2345EF', ...(await captchaOf()) })
      .expect(409);

    expect(res.body.message).toBe('邀请码已被用尽');
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('作废码：409', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue({ ...codeRow, status: 'REVOKED' });

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'ABCD2345EF', ...(await captchaOf()) })
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
      .send({ ...registerBody, inviteCode: 'ABCD2345EF', ...(await captchaOf()) })
      .expect(409);

    expect(res.body.message).toBe('邀请码已过期');
  });

  it('无效码：409', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'NOPE2345XX', ...(await captchaOf()) })
      .expect(409);

    expect(res.body.message).toBe('邀请码无效');
  });

  it('落库失败：回退核销计数', async () => {
    inviteCodesRepository.findByCode.mockResolvedValue(codeRow);
    inviteCodesRepository.tryConsume.mockResolvedValue({ ...codeRow, usedCount: 1 });
    usersRepository.insert.mockRejectedValue(new ConflictException('该邮箱或手机号已被注册'));

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, inviteCode: 'ABCD2345EF', ...(await captchaOf()) })
      .expect(409);

    expect(inviteCodesRepository.release).toHaveBeenCalledWith(codeRow.id);
  });

  // ===== 注册：密码规则与验证码（v6.0） =====

  it('注册确认密码不一致：400「两次输入的密码不一致」', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, passwordConfirm: 'other-pass-1', ...(await captchaOf()) })
      .expect(400);

    expect(res.body.message).toEqual(expect.arrayContaining(['两次输入的密码不一致']));
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('弱密码（单类字符）：400 并列出复杂度要求', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        ...registerBody,
        password: 'abcdefgh',
        passwordConfirm: 'abcdefgh',
        ...(await captchaOf()),
      })
      .expect(400);

    expect(res.body.message).toEqual(
      expect.arrayContaining(['密码需包含大写字母、小写字母、数字、符号中的至少两类']),
    );
  });

  it('identifier 格式非法：400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, identifier: 'not-an-email', ...(await captchaOf()) })
      .expect(400);

    expect(res.body.message).toEqual(expect.arrayContaining(['请输入合法的邮箱或手机号']));
  });

  it('captchaId / captchaCode 缺失：400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerBody)
      .expect(400);

    expect(res.body.message).toEqual(
      expect.arrayContaining(['captchaId 不能为空', 'captchaCode 不能为空']),
    );
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('错误验证码：400「验证码错误或已失效」', async () => {
    const { captchaId, captchaCode } = await captchaOf();
    const wrongCode = captchaCode[0] === 'A' ? `B${captchaCode.slice(1)}` : `A${captchaCode.slice(1)}`;

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, captchaId, captchaCode: wrongCode })
      .expect(400);

    expect(res.body.message).toBe('验证码错误或已失效');
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('验证码过期（模拟 TTL 过后）：400', async () => {
    const { captchaId, captchaCode } = await captchaOf();
    // TTL 过后 Redis 键消失：显式删除模拟 5 分钟到期
    await fakeRedis.del(`captcha:${captchaId}`);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, captchaId, captchaCode })
      .expect(400);

    expect(res.body.message).toBe('验证码错误或已失效');
  });

  it('正确验证码全链路注册成功', async () => {
    usersRepository.insert.mockResolvedValue(row({ role: Role.VISITOR }));

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, ...(await captchaOf()) })
      .expect(201);

    expect(res.body.id).toBe(SELF_ID);
    expect(usersRepository.insert).toHaveBeenCalledTimes(1);
  });

  it('验证码一次性：同 captchaId 复用第二次 400', async () => {
    usersRepository.insert.mockResolvedValue(row({ role: Role.VISITOR }));
    const captcha = await captchaOf();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, ...captcha })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...registerBody, ...captcha })
      .expect(400);

    expect(res.body.message).toBe('验证码错误或已失效');
  });

  // ===== 登录 / 改密 / 转正（v6.0 验证码路径） =====

  it('登录带正确验证码：成功', async () => {
    usersRepository.findByEmailHmacOrPhoneHmac.mockResolvedValue(row());

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: 'A@Example.com', password: 'password123', ...(await captchaOf()) })
      .expect(201);

    // 登录精确查走 HMAC 列（v10.0）：identifier 归一化（邮箱小写）后取 hmac
    expect(usersRepository.findByEmailHmacOrPhoneHmac).toHaveBeenCalledWith(
      testCrypto.hmac('a@example.com'),
      testCrypto.hmac('a@example.com'),
    );
    expect(res.body.id).toBe(SELF_ID);
  });

  it('登录错误验证码：400 且不查账号', async () => {
    const { captchaId, captchaCode } = await captchaOf();
    const wrongCode = captchaCode[0] === 'A' ? `B${captchaCode.slice(1)}` : `A${captchaCode.slice(1)}`;

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: 'a@example.com', password: 'password123', captchaId, captchaCode: wrongCode })
      .expect(400);

    expect(res.body.message).toBe('验证码错误或已失效');
    expect(usersRepository.findByEmailHmacOrPhoneHmac).not.toHaveBeenCalled();
  });

  it('改密带正确验证码：204 并吊销全部 refresh', async () => {
    await request(app.getHttpServer())
      .post('/auth/password')
      .set('Cookie', [`access_token=${tokenFor(Role.MEMBER)}`])
      .send({
        currentPassword: 'password123',
        newPassword: 'newPassword123',
        ...(await captchaOf()),
      })
      .expect(204);

    expect(usersRepository.updatePasswordHash).toHaveBeenCalledWith(SELF_ID, expect.any(String));
    expect(refreshStore.revokeAll).toHaveBeenCalledWith(SELF_ID);
  });

  it('改密错误验证码：400 且不改密码', async () => {
    const { captchaId, captchaCode } = await captchaOf();
    const wrongCode = captchaCode[0] === 'A' ? `B${captchaCode.slice(1)}` : `A${captchaCode.slice(1)}`;

    await request(app.getHttpServer())
      .post('/auth/password')
      .set('Cookie', [`access_token=${tokenFor(Role.MEMBER)}`])
      .send({
        currentPassword: 'password123',
        newPassword: 'newPassword123',
        captchaId,
        captchaCode: wrongCode,
      })
      .expect(400);

    expect(usersRepository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('换绑邮箱带正确验证码：200 成功', async () => {
    usersRepository.updateIdentifier.mockResolvedValue(row({ email: 'new@example.com', phone: null }));

    const res = await request(app.getHttpServer())
      .put('/users/me/identifier')
      .set('Cookie', [`access_token=${tokenFor(Role.MEMBER)}`])
      .send({ type: 'email', value: 'new@example.com', password: 'password123', ...(await captchaOf()) })
      .expect(200);

    expect(usersRepository.updateIdentifier).toHaveBeenCalledWith(
      SELF_ID,
      expect.objectContaining({
        phone: null,
        phoneHmac: null,
        emailHmac: testCrypto.hmac('new@example.com'),
      }),
      expect.anything(),
    );
    // 库内为信封 token（非明文）；接口响应仍是明文
    const patch = usersRepository.updateIdentifier.mock.calls[0][1];
    expect(patch.email).toMatch(/^v1\./);
    expect(testCrypto.open('email', patch.email, SELF_CRYPTO_ID)).toBe('new@example.com');
    expect(res.body.email).toBe('new@example.com');
  });

  it('换绑错误验证码：400 且不落库', async () => {
    const { captchaId, captchaCode } = await captchaOf();
    const wrongCode = captchaCode[0] === 'A' ? `B${captchaCode.slice(1)}` : `A${captchaCode.slice(1)}`;

    await request(app.getHttpServer())
      .put('/users/me/identifier')
      .set('Cookie', [`access_token=${tokenFor(Role.MEMBER)}`])
      .send({ type: 'email', value: 'new@example.com', password: 'password123', captchaId, captchaCode: wrongCode })
      .expect(400);

    expect(usersRepository.updateIdentifier).not.toHaveBeenCalled();
  });

  it('邀请码转正带正确验证码：VISITOR 升 MEMBER 并换发 token', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.VISITOR }));
    inviteCodesRepository.findByCode.mockResolvedValue(codeRow);
    inviteCodesRepository.tryConsume.mockResolvedValue({ ...codeRow, usedCount: 1 });
    usersRepository.applyInviteCode.mockResolvedValue(row({ role: Role.MEMBER }));

    const res = await request(app.getHttpServer())
      .post('/auth/invite-code')
      .set('Cookie', [`access_token=${tokenFor(Role.VISITOR)}`])
      .send({ inviteCode: 'ABCD2345EF', ...(await captchaOf()) })
      .expect(201);

    expect(usersRepository.applyInviteCode).toHaveBeenCalledWith(SELF_ID, codeRow.id);
    expect(refreshStore.revokeAll).toHaveBeenCalledWith(SELF_ID);
    expect(res.body.role).toBe(Role.MEMBER);
  });

  it('邀请码转正错误验证码：400 且不核销', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.VISITOR }));
    const { captchaId, captchaCode } = await captchaOf();
    const wrongCode = captchaCode[0] === 'A' ? `B${captchaCode.slice(1)}` : `A${captchaCode.slice(1)}`;

    await request(app.getHttpServer())
      .post('/auth/invite-code')
      .set('Cookie', [`access_token=${tokenFor(Role.VISITOR)}`])
      .send({ inviteCode: 'ABCD2345EF', captchaId, captchaCode: wrongCode })
      .expect(400);

    expect(inviteCodesRepository.findByCode).not.toHaveBeenCalled();
    expect(usersRepository.applyInviteCode).not.toHaveBeenCalled();
  });

  // ===== 文档站访问探针（v11.0，nginx auth_request 门禁） =====

  it('文档探针：未登录 401', async () => {
    await request(app.getHttpServer()).get('/auth/docs-probe').expect(401);
  });

  it('文档探针：VISITOR 403，MEMBER 及以上 204', async () => {
    usersRepository.findById.mockResolvedValue(row({ role: Role.VISITOR }));
    await request(app.getHttpServer())
      .get('/auth/docs-probe')
      .set('Cookie', [`access_token=${tokenFor(Role.VISITOR)}`])
      .expect(403);
    usersRepository.findById.mockResolvedValue(row({ role: Role.MEMBER }));
    await request(app.getHttpServer())
      .get('/auth/docs-probe')
      .set('Cookie', [`access_token=${tokenFor(Role.MEMBER)}`])
      .expect(204);
    usersRepository.findById.mockResolvedValue(row({ role: Role.ALUMNI }));
    await request(app.getHttpServer())
      .get('/auth/docs-probe')
      .set('Cookie', [`access_token=${tokenFor(Role.ALUMNI)}`])
      .expect(204);
  });
});
