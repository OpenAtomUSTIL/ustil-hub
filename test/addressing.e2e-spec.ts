/* 解析式寻址 e2e（v6.0）：uuid 之外支持 username / email / 手机号
   - 日志筛选（request-logs userId / audit-logs actorId）与内容列表（authorId / creatorId）
     按标识命中→解析成 userId 过滤，未命中→空列表（过滤语义不报错）
   - 用户管理路径参数（改角色/提拔/剔除/封禁/解封）按标识命中成功，不存在→404
   - uuid 寻址回归不变；GET /auth/captcha 返回结构
   风格同 guards/register：真实 controller + service，仓储打桩（标识→用户的解析链
   在 users.repository.spec 单测覆盖，此处以标识映射表模拟用户表） */
import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost, APP_GUARD } from '@nestjs/core';
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
import { AuditLogRepository } from '../src/modules/audit/audit-log.repository';
import { AdminLogsService } from '../src/modules/audit/admin-logs.service';
import { LoginLogsRepository } from '../src/modules/audit/login-logs.repository';
import { RequestLogsRepository } from '../src/modules/audit/request-logs.repository';
import { RequestLogsController } from '../src/modules/audit/request-logs.controller';
import { AuditLogsController } from '../src/modules/audit/audit-logs.controller';
import { AdminUsersController } from '../src/modules/admin/admin-users.controller';
import { ArticlesController } from '../src/modules/articles/articles.controller';
import { ArticlesRepository } from '../src/modules/articles/articles.repository';
import { ArticlesService } from '../src/modules/articles/articles.service';
import { IssuesController } from '../src/modules/issues/issues.controller';
import { IssuesRepository } from '../src/modules/issues/issues.repository';
import { IssuesService } from '../src/modules/issues/issues.service';
import { ResourcesController } from '../src/modules/resources/resources.controller';
import { ResourcesRepository } from '../src/modules/resources/resources.repository';
import { ResourcesService } from '../src/modules/resources/resources.service';
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

const TARGET_ID = '01890a5d-ac96-7000-8000-000000000001';
const UUID_TARGET_ID = '01890a5d-ac96-7000-8000-000000000009';

describe('解析式寻址（v6.0 e2e）', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const now = new Date('2026-01-01T00:00:00.000Z');

  function row(overrides: Partial<UserRow> = {}): UserRow {
    return {
      id: TARGET_ID,
      email: 'a@example.com',
      phone: '13800138000',
      passwordHash: 'hash',
      nickname: '测试用户',
      username: 'alice',
      avatarUrl: null,
      bio: null,
      role: Role.MEMBER,
      status: UserStatus.ACTIVE,
      sessionVersion: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as UserRow;
  }

  // 标识 → 用户映射表（模拟 users 表；解析顺序本身由 users.repository.spec 覆盖）
  const usersByIdentifier = new Map<string, UserRow>([
    [TARGET_ID, row()],
    [UUID_TARGET_ID, row({ id: UUID_TARGET_ID, username: 'bob', email: 'b@example.com', phone: '13800138001' })],
    ['alice', row()],
    ['a@example.com', row()],
    ['13800138000', row()],
  ]);
  const actorsById = new Map<string, UserRow>([
    ['user-admin', row({ id: 'user-admin', role: Role.ADMIN, username: 'admin' })],
    ['user-wheel', row({ id: 'user-wheel', role: Role.WHEEL, username: 'wheel' })],
    ['user-member', row({ id: 'user-member', role: Role.MEMBER, username: 'member' })],
    ['user-visitor', row({ id: 'user-visitor', role: Role.VISITOR, username: 'visitor' })],
  ]);

  const usersRepository = {
    findById: jest.fn(),
    findByIdentifier: jest.fn(),
    findByUsername: jest.fn(),
    findByEmailOrPhone: jest.fn(),
    findByIds: jest.fn(),
    updateRole: jest.fn(),
    updateStatus: jest.fn(),
    deleteById: jest.fn(),
    listForAdmin: jest.fn(),
    invalidateSessions: jest.fn(),
  };
  const requestLogsRepository = { list: jest.fn() };
  const auditLogRepository = { list: jest.fn(), insert: jest.fn() };
  const loginLogsRepository = { list: jest.fn(), insert: jest.fn() };
  const articlesRepository = { list: jest.fn(), findByIdOrSlug: jest.fn() };
  const issuesRepository = {
    list: jest.fn(),
    findByIdOrSlug: jest.fn(),
    countReplies: jest.fn(),
  };
  const resourcesRepository = { list: jest.fn(), findByIdOrSlug: jest.fn() };
  const tagsService = {
    findTargetIds: jest.fn(),
    getNamesByTargets: jest.fn(),
    cleanupIssuesOfAuthor: jest.fn(),
    cleanup: jest.fn(),
  };
  const notificationsService = { notifyUser: jest.fn(), notifyUsers: jest.fn() };
  const auditLogService = { record: jest.fn() };
  const refreshStore = { register: jest.fn(), rotate: jest.fn(), revokeAll: jest.fn() };

  const tokenFor = (userId: string): string =>
    jwtService.sign(
      { sub: userId, role: actorsById.get(userId)!.role, sessionVersion: 0 },
      { secret: testConfig.jwtAccessSecret, expiresIn: 60 },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        CaptchaController,
        RequestLogsController,
        AuditLogsController,
        ArticlesController,
        IssuesController,
        ResourcesController,
        AdminUsersController,
        UsersController,
      ],
      providers: [
        CaptchaService,
        UsersService,
        AdminLogsService,
        ArticlesService,
        IssuesService,
        ResourcesService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: RequestLogsRepository, useValue: requestLogsRepository },
        { provide: AuditLogRepository, useValue: auditLogRepository },
        { provide: LoginLogsRepository, useValue: loginLogsRepository },
        { provide: ArticlesRepository, useValue: articlesRepository },
        { provide: IssuesRepository, useValue: issuesRepository },
        { provide: ResourcesRepository, useValue: resourcesRepository },
        { provide: TagsService, useValue: tagsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: UploadsService, useValue: {} },
        { provide: SnakeService, useValue: {} },
        { provide: JwtService, useValue: new JwtService({ secret: testConfig.jwtAccessSecret }) },
        { provide: REDIS_CLIENT, useValue: new FakeRedis() },
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
  });

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepository.findById.mockImplementation(async (id: string) =>
      actorsById.get(id) ?? usersByIdentifier.get(id) ?? null,
    );
    usersRepository.findByIdentifier.mockImplementation(async (v: string) =>
      usersByIdentifier.get(v.trim()) ?? null,
    );
    requestLogsRepository.list.mockResolvedValue({ rows: [], total: 0 });
    auditLogRepository.list.mockResolvedValue({ rows: [], total: 0 });
    articlesRepository.list.mockResolvedValue({ rows: [], total: 0 });
    issuesRepository.list.mockResolvedValue({ rows: [], total: 0 });
    issuesRepository.countReplies.mockResolvedValue(new Map());
    resourcesRepository.list.mockResolvedValue({ rows: [], total: 0 });
    tagsService.getNamesByTargets.mockResolvedValue(new Map());
    tagsService.findTargetIds.mockResolvedValue([]);
    usersRepository.findByIds.mockResolvedValue([]);
    usersRepository.updateRole.mockResolvedValue(row({ role: Role.WHEEL }));
    usersRepository.updateStatus.mockResolvedValue(row({ status: UserStatus.BANNED }));
    usersRepository.deleteById.mockResolvedValue(row({ role: Role.VISITOR }));
  });

  it('GET /auth/captcha 返回 captchaId + SVG data URI', async () => {
    const res = await request(app.getHttpServer()).get('/auth/captcha').expect(200);

    expect(typeof res.body.captchaId).toBe('string');
    expect(res.body.captchaId.length).toBeGreaterThan(0);
    expect(res.body.image).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('request-logs userId：email / 用户名 / 手机号命中并按 userId 过滤', async () => {
    for (const identifier of ['a@example.com', 'alice', '13800138000']) {
      requestLogsRepository.list.mockClear();

      const res = await request(app.getHttpServer())
        .get('/admin/request-logs')
        .query({ userId: identifier })
        .set('Cookie', [`access_token=${tokenFor('user-wheel')}`])
        .expect(200);

      expect(requestLogsRepository.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TARGET_ID }),
      );
      expect(res.body.items).toEqual([]);
    }
  });

  it('request-logs userId 未命中：返回空列表（过滤语义不报错）', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/request-logs')
      .query({ userId: 'ghost@example.com' })
      .set('Cookie', [`access_token=${tokenFor('user-wheel')}`])
      .expect(200);

    expect(res.body).toMatchObject({ items: [], total: 0 });
    expect(requestLogsRepository.list).not.toHaveBeenCalled();
  });

  it('audit-logs actorId：email / 用户名 / 手机号命中并按 actorId 过滤', async () => {
    for (const identifier of ['a@example.com', 'alice', '13800138000']) {
      auditLogRepository.list.mockClear();

      await request(app.getHttpServer())
        .get('/admin/audit-logs')
        .query({ actorId: identifier })
        .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
        .expect(200);

      expect(auditLogRepository.list).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: TARGET_ID }),
      );
    }
  });

  it('audit-logs actorId 未命中：返回空列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .query({ actorId: 'ghost' })
      .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
      .expect(200);

    expect(res.body).toMatchObject({ items: [], total: 0 });
    expect(auditLogRepository.list).not.toHaveBeenCalled();
  });

  it('文章/讨论/资源列表：authorId / creatorId 按标识命中并过滤', async () => {
    await request(app.getHttpServer())
      .get('/articles')
      .query({ authorId: 'a@example.com' })
      .set('Cookie', [`access_token=${tokenFor('user-member')}`])
      .expect(200);
    expect(articlesRepository.list).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ authorId: TARGET_ID }),
    );

    await request(app.getHttpServer())
      .get('/issues')
      .query({ authorId: 'alice' })
      .set('Cookie', [`access_token=${tokenFor('user-member')}`])
      .expect(200);
    expect(issuesRepository.list).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ authorId: TARGET_ID }),
    );

    await request(app.getHttpServer())
      .get('/resources')
      .query({ creatorId: '13800138000' })
      .set('Cookie', [`access_token=${tokenFor('user-member')}`])
      .expect(200);
    expect(resourcesRepository.list).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ creatorId: TARGET_ID }),
    );
  });

  it('文章/讨论/资源列表：标识未命中返回空列表', async () => {
    const member = tokenFor('user-member');

    const articles = await request(app.getHttpServer())
      .get('/articles')
      .query({ authorId: 'ghost@example.com' })
      .set('Cookie', [`access_token=${member}`])
      .expect(200);
    expect(articles.body).toMatchObject({ items: [], total: 0 });

    const issues = await request(app.getHttpServer())
      .get('/issues')
      .query({ authorId: 'ghost@example.com' })
      .set('Cookie', [`access_token=${member}`])
      .expect(200);
    expect(issues.body).toMatchObject({ items: [], total: 0 });

    const resources = await request(app.getHttpServer())
      .get('/resources')
      .query({ creatorId: 'ghost@example.com' })
      .set('Cookie', [`access_token=${member}`])
      .expect(200);
    expect(resources.body).toMatchObject({ items: [], total: 0 });

    expect(articlesRepository.list).not.toHaveBeenCalled();
    expect(issuesRepository.list).not.toHaveBeenCalled();
    expect(resourcesRepository.list).not.toHaveBeenCalled();
  });

  it('用户管理：email 寻址改角色 / 提拔 / 剔除成功', async () => {
    const admin = tokenFor('user-admin');

    await request(app.getHttpServer())
      .patch('/admin/users/a@example.com/role')
      .set('Cookie', [`access_token=${admin}`])
      .send({ role: 'WHEEL' })
      .expect(200);
    expect(usersRepository.updateRole).toHaveBeenCalledWith(TARGET_ID, Role.WHEEL, Role.MEMBER);

    await request(app.getHttpServer())
      .post('/admin/users/a@example.com/promote')
      .set('Cookie', [`access_token=${admin}`])
      .expect(201);
    expect(usersRepository.updateRole).toHaveBeenCalledWith(TARGET_ID, Role.ALUMNI, Role.MEMBER);

    await request(app.getHttpServer())
      .delete('/admin/users/a@example.com')
      .set('Cookie', [`access_token=${admin}`])
      .expect(204);
    expect(usersRepository.deleteById).toHaveBeenCalledWith(TARGET_ID, 'user-admin');
  });

  it('封禁 / 解封：email 寻址成功', async () => {
    const admin = tokenFor('user-admin');

    await request(app.getHttpServer())
      .post('/users/a@example.com/ban')
      .set('Cookie', [`access_token=${admin}`])
      .expect(201);
    expect(usersRepository.updateStatus).toHaveBeenCalledWith(TARGET_ID, UserStatus.BANNED);

    await request(app.getHttpServer())
      .post('/users/a@example.com/unban')
      .set('Cookie', [`access_token=${admin}`])
      .expect(201);
    expect(usersRepository.updateStatus).toHaveBeenCalledWith(TARGET_ID, UserStatus.ACTIVE);
    expect(refreshStore.revokeAll).toHaveBeenCalledWith(TARGET_ID);
  });

  it('不存在的标识：路径参数类返回 404「用户不存在」', async () => {
    const admin = tokenFor('user-admin');

    const res = await request(app.getHttpServer())
      .patch('/admin/users/ghost@example.com/role')
      .set('Cookie', [`access_token=${admin}`])
      .send({ role: 'WHEEL' })
      .expect(404);
    expect(res.body.message).toBe('用户不存在');

    await request(app.getHttpServer())
      .post('/users/ghost@example.com/ban')
      .set('Cookie', [`access_token=${admin}`])
      .expect(404);

    expect(usersRepository.updateRole).not.toHaveBeenCalled();
    expect(usersRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('uuid 寻址回归不变：日志筛选与用户管理路径参数', async () => {
    await request(app.getHttpServer())
      .get('/admin/request-logs')
      .query({ userId: UUID_TARGET_ID })
      .set('Cookie', [`access_token=${tokenFor('user-wheel')}`])
      .expect(200);
    expect(requestLogsRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: UUID_TARGET_ID }),
    );

    await request(app.getHttpServer())
      .patch(`/admin/users/${UUID_TARGET_ID}/role`)
      .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
      .send({ role: 'ALUMNI' })
      .expect(200);
    expect(usersRepository.updateRole).toHaveBeenCalledWith(UUID_TARGET_ID, Role.ALUMNI, Role.MEMBER);
  });
  it('直接请求发布接口：未登录 401，访客伪造正文中的角色也只能得到 403', async () => {
    await request(app.getHttpServer()).post('/articles')
      .send({ title: '绕过页面', content: '正文' }).expect(401);
    await request(app.getHttpServer()).post('/articles')
      .set('Cookie', [`access_token=${tokenFor('user-visitor')}`])
      .send({ title: '绕过页面', content: '正文', role: 'ADMIN' }).expect(403);
  });

});
