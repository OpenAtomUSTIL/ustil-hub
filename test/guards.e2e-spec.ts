import { Controller, Get, INestApplication, Post, Query } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { CurrentAuthUser, CurrentUser } from '../src/common/decorators/current-user.decorator';
import { Public } from '../src/common/decorators/public.decorator';
import { Role, Roles } from '../src/common/decorators/roles.decorator';
import { PaginationQueryDto } from '../src/common/dto/pagination-query.dto';
import { appValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AppConfig, configuration } from '../src/config/configuration';
import { UserStatus } from '../src/db/schema';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { UsersService } from '../src/modules/users/users.service';
import { APP_GUARD } from '@nestjs/core';

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

@Controller('probe')
class ProbeController {
  @Get('public')
  @Public()
  publicRoute() {
    return { ok: true };
  }

  @Get('secure')
  secureRoute(@CurrentUser() user: CurrentAuthUser) {
    return { userId: user.id, role: user.role };
  }

  @Post('admin')
  @Roles(Role.ADMIN)
  adminRoute() {
    return { ok: true };
  }

  @Get('paged')
  @Public()
  pagedRoute(@Query() _query: PaginationQueryDto) {
    return { ok: true };
  }
}

describe('JwtAuthGuard / RolesGuard（e2e 冒烟）', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const usersById: Record<
    string,
    { id: string; role: Role; status: UserStatus; sessionVersion: number }
  > = {
    'user-member': { id: 'user-member', role: Role.MEMBER, status: UserStatus.ACTIVE, sessionVersion: 0 },
    'user-admin': { id: 'user-admin', role: Role.ADMIN, status: UserStatus.ACTIVE, sessionVersion: 0 },
    'user-banned': { id: 'user-banned', role: Role.MEMBER, status: UserStatus.BANNED, sessionVersion: 0 },
  };

  const usersService = {
    getAuthUser: jest.fn((id: string) => Promise.resolve(usersById[id] ?? null)),
    getSelf: jest.fn(),
    getPublic: jest.fn(),
    getPublicByIds: jest.fn(),
  };

  const tokenFor = (userId: string): string =>
    jwtService.sign(
      { sub: userId, role: usersById[userId].role, sessionVersion: 0 },
      { secret: testConfig.jwtAccessSecret, expiresIn: 60 },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: usersService },
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('@Public 接口无需登录即可访问', async () => {
    await request(app.getHttpServer()).get('/probe/public').expect(200, { ok: true });
  });

  it('缺少 token 返回 401 且错误体为固定结构', async () => {
    const res = await request(app.getHttpServer()).get('/probe/secure').expect(401);
    expect(res.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: expect.any(String),
      path: '/probe/secure',
      timestamp: expect.any(String),
    });
  });

  it('携带合法 access_token 可访问受保护接口', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/secure')
      .set('Cookie', [`access_token=${tokenFor('user-member')}`])
      .expect(200);
    expect(res.body).toEqual({ userId: 'user-member', role: Role.MEMBER });
  });

  it('MEMBER 访问 @Roles(ADMIN) 接口返回 403', async () => {
    await request(app.getHttpServer())
      .post('/probe/admin')
      .set('Cookie', [`access_token=${tokenFor('user-member')}`])
      .expect(403);
  });

  it('ADMIN 访问 @Roles(ADMIN) 接口返回 200', async () => {
    await request(app.getHttpServer())
      .post('/probe/admin')
      .set('Cookie', [`access_token=${tokenFor('user-admin')}`])
      .expect(201);
  });

  it('被封禁用户即使持有合法 token 也返回 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/secure')
      .set('Cookie', [`access_token=${tokenFor('user-banned')}`])
      .expect(403);
    expect(res.body.message).toBe('账号已被封禁');
  });

  it('pageSize 超过 100 返回 400（拒绝而非截断）', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/paged?page=1&pageSize=200')
      .expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('pageSize')]));
  });

  it('分页参数缺省为 page=1&pageSize=20', async () => {
    await request(app.getHttpServer()).get('/probe/paged').expect(200, { ok: true });
  });
});
