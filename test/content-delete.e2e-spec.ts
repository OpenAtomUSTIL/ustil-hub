import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { CRYPTO_MASTER_KEY, CryptoService } from '../src/common/crypto/crypto.service';
import { Role } from '../src/common/decorators/roles.decorator';
import { appValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AppConfig, configuration } from '../src/config/configuration';
import { UserStatus } from '../src/db/schema';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { UsersService } from '../src/modules/users/users.service';
import { IssuesController } from '../src/modules/issues/issues.controller';
import { IssuesService } from '../src/modules/issues/issues.service';
import { AssignmentsController } from '../src/modules/assignments/assignments.controller';
import { AssignmentsService } from '../src/modules/assignments/assignments.service';
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

const targetId = '01890a5d-ac96-7000-8000-0000000000aa';

describe('删除讨论/作业（守卫 e2e 冒烟）', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const usersById: Record<string, { id: string; role: Role; status: UserStatus; sessionVersion: number }> = {
    'user-visitor': { id: 'user-visitor', role: Role.VISITOR, status: UserStatus.ACTIVE, sessionVersion: 0 },
    'user-member': { id: 'user-member', role: Role.MEMBER, status: UserStatus.ACTIVE, sessionVersion: 0 },
    'user-alumni': { id: 'user-alumni', role: Role.ALUMNI, status: UserStatus.ACTIVE, sessionVersion: 0 },
    'user-wheel': { id: 'user-wheel', role: Role.WHEEL, status: UserStatus.ACTIVE, sessionVersion: 0 },
    'user-admin': { id: 'user-admin', role: Role.ADMIN, status: UserStatus.ACTIVE, sessionVersion: 0 },
  };

  const usersService = {
    getAuthUser: jest.fn(),
  };
  const issuesService = {
    softDeleteIssue: jest.fn(),
  };
  const assignmentsService = {
    softDeleteAssignment: jest.fn(),
  };

  const tokenFor = (userId: string): string =>
    jwtService.sign(
      { sub: userId, role: usersById[userId].role, sessionVersion: 0 },
      { secret: testConfig.jwtAccessSecret, expiresIn: 60 },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IssuesController, AssignmentsController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: IssuesService, useValue: issuesService },
        { provide: AssignmentsService, useValue: assignmentsService },
        { provide: CRYPTO_MASTER_KEY, useValue: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' },
        CryptoService,
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getAuthUser.mockImplementation(async (id: string) => usersById[id] ?? null);
    issuesService.softDeleteIssue.mockResolvedValue(undefined);
    assignmentsService.softDeleteAssignment.mockResolvedValue(undefined);
  });

  it('未登录删除讨论/作业返回 401', async () => {
    await request(app.getHttpServer()).delete(`/issues/${targetId}`).expect(401);
    await request(app.getHttpServer()).delete(`/assignments/${targetId}`).expect(401);
    expect(issuesService.softDeleteIssue).not.toHaveBeenCalled();
    expect(assignmentsService.softDeleteAssignment).not.toHaveBeenCalled();
  });

  it('VISITOR / MEMBER / ALUMNI 删除返回 403', async () => {
    for (const userId of ['user-visitor', 'user-member', 'user-alumni']) {
      await request(app.getHttpServer())
        .delete(`/issues/${targetId}`)
        .set('Cookie', [`access_token=${tokenFor(userId)}`])
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/assignments/${targetId}`)
        .set('Cookie', [`access_token=${tokenFor(userId)}`])
        .expect(403);
    }
    expect(issuesService.softDeleteIssue).not.toHaveBeenCalled();
    expect(assignmentsService.softDeleteAssignment).not.toHaveBeenCalled();
  });

  it('WHEEL / ADMIN 删除讨论与作业返回 204', async () => {
    for (const userId of ['user-wheel', 'user-admin']) {
      await request(app.getHttpServer())
        .delete(`/issues/${targetId}`)
        .set('Cookie', [`access_token=${tokenFor(userId)}`])
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/assignments/${targetId}`)
        .set('Cookie', [`access_token=${tokenFor(userId)}`])
        .expect(204);
    }
    expect(issuesService.softDeleteIssue).toHaveBeenCalledTimes(2);
    expect(assignmentsService.softDeleteAssignment).toHaveBeenCalledTimes(2);
  });
});
