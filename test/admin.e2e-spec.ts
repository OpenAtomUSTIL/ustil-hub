/* 管理后台接口守卫 e2e 冒烟：WHEEL/ADMIN 放行，MEMBER/VISITOR 403，改角色仅 ADMIN */
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
import { UserStatus } from '../src/db/schema';
import { AdminUsersController } from '../src/modules/admin/admin-users.controller';
import { InviteCodesController } from '../src/modules/admin/invite-codes.controller';
import { InviteCodesRepository } from '../src/modules/admin/invite-codes.repository';
import { InviteCodesService } from '../src/modules/admin/invite-codes.service';
import { StatsController } from '../src/modules/admin/stats.controller';
import { StatsService } from '../src/modules/admin/stats.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { UsersService } from '../src/modules/users/users.service';

const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
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

describe('管理后台接口（守卫 e2e 冒烟）', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const usersById: Record<string, { id: string; role: Role; status: UserStatus }> = {
    'user-visitor': { id: 'user-visitor', role: Role.VISITOR, status: UserStatus.ACTIVE },
    'user-member': { id: 'user-member', role: Role.MEMBER, status: UserStatus.ACTIVE },
    'user-wheel': { id: 'user-wheel', role: Role.WHEEL, status: UserStatus.ACTIVE },
    'user-admin': { id: 'user-admin', role: Role.ADMIN, status: UserStatus.ACTIVE },
  };

  const usersService = {
    getAuthUser: jest.fn(),
    listForAdmin: jest.fn(),
    updateRole: jest.fn(),
    promoteToAlumni: jest.fn(),
    removeByAdmin: jest.fn(),
    countByRole: jest.fn(),
    countVisitorsCreatedBefore: jest.fn(),
  };
  const inviteCodesService = {
    generate: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    consume: jest.fn(),
    release: jest.fn(),
  };
  const inviteCodesRepository = {
    countActive: jest.fn(),
  };

  const tokenFor = (userId: string): string =>
    jwtService.sign(
      { sub: userId, role: usersById[userId].role },
      { secret: testConfig.jwtAccessSecret, expiresIn: 60 },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminUsersController, InviteCodesController, StatsController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: InviteCodesService, useValue: inviteCodesService },
        { provide: InviteCodesRepository, useValue: inviteCodesRepository },
        StatsService,
        JwtStrategy,
        { provide: configuration.KEY, useValue: testConfig },
        { provide: JwtService, useValue: new JwtService({ secret: testConfig.jwtAccessSecret }) },
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
    usersService.getAuthUser.mockImplementation(async (id: string) => usersById[id] ?? null);
    usersService.listForAdmin.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    inviteCodesService.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getAuthUser.mockImplementation(async (id: string) => usersById[id] ?? null);
    usersService.listForAdmin.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    inviteCodesService.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('WHEEL / ADMIN 可访问用户列表与邀请码列表', async () => {
    await request(app.getHttpServer())
      .get('/admin/users')
      .set('Cookie', [`access_token=${tokenFor('user-wheel')}`])
      .expect(200);
    await request(app.getHttpServer())
      .get('/admin/invite-codes')
      .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
      .expect(200);
  });

  it('MEMBER / VISITOR 访问管理接口返回 403', async () => {
    for (const userId of ['user-member', 'user-visitor']) {
      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Cookie', [`access_token=${tokenFor(userId)}`])
        .expect(403);
      await request(app.getHttpServer())
        .get('/admin/invite-codes')
        .set('Cookie', [`access_token=${tokenFor(userId)}`])
        .expect(403);
    }
  });

  it('未登录访问管理接口返回 401', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });

  it('改角色仅 ADMIN：WHEEL 返回 403，ADMIN 返回 200', async () => {
    usersService.updateRole.mockResolvedValue({ id: '01890a5d-ac96-7000-8000-000000000009', role: Role.WHEEL });

    await request(app.getHttpServer())
      .patch('/admin/users/01890a5d-ac96-7000-8000-000000000009/role')
      .set('Cookie', [`access_token=${tokenFor('user-wheel')}`])
      .send({ role: 'WHEEL' })
      .expect(403);
    expect(usersService.updateRole).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .patch('/admin/users/01890a5d-ac96-7000-8000-000000000009/role')
      .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
      .send({ role: 'WHEEL' })
      .expect(200);
    expect(usersService.updateRole).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-000000000009', 'WHEEL');
  });

  it('改角色不接受 ADMIN 取值', async () => {
    const res = await request(app.getHttpServer())
      .patch('/admin/users/01890a5d-ac96-7000-8000-000000000009/role')
      .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
      .send({ role: 'ADMIN' })
      .expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(usersService.updateRole).not.toHaveBeenCalled();
  });

  it('提前提拔与剔除：WHEEL / ADMIN 均可', async () => {
    usersService.promoteToAlumni.mockResolvedValue({ id: 'u1', role: Role.ALUMNI });
    usersService.removeByAdmin.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .post('/admin/users/01890a5d-ac96-7000-8000-000000000009/promote')
      .set('Cookie', [`access_token=${tokenFor('user-wheel')}`])
      .expect(201);
    await request(app.getHttpServer())
      .delete('/admin/users/01890a5d-ac96-7000-8000-000000000009')
      .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
      .expect(204);
  });

  it('统计接口：WHEEL 可访问，MEMBER 403', async () => {
    usersService.countByRole.mockResolvedValue({ VISITOR: 1, MEMBER: 2, ALUMNI: 3, WHEEL: 1, ADMIN: 1 });
    usersService.countVisitorsCreatedBefore.mockResolvedValue(1);
    inviteCodesRepository.countActive.mockResolvedValue(4);

    const res = await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Cookie', [`access_token=${tokenFor('user-wheel')}`])
      .expect(200);
    expect(res.body.users.MEMBER).toBe(2);

    await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Cookie', [`access_token=${tokenFor('user-member')}`])
      .expect(403);
  });
});
