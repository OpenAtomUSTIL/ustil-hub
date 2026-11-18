import { sql } from 'drizzle-orm';
import { Role } from '../../common/decorators/roles.decorator';
import { CryptoService } from '../../common/crypto/crypto.service';
import { db } from '../../db';
import { RefreshTokenStore } from '../../db/redis';
import {
  announcements,
  attachments,
  articles,
  assignmentSubmissions,
  assignments,
  issues,
  resources,
  taggings,
  UserStatus,
  users,
} from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { CaptchaService } from '../captcha/captcha.service';
import { EmailCodeService } from '../mail/email-code.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../storage/uploads.service';
import { UsersRepository, UserRow } from './users.repository';
import { UsersService } from './users.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '01890a5d-ac96-7000-8000-000000000001',
    email: 'a@example.com',
    phone: null,
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

/** 解析式寻址（v6.0→v10.0）resolveRowByIdentifier：uuid → username（含历史 handle）→ email → phone；精确查走 HMAC 列 */
describe('UsersService.resolveRowByIdentifier', () => {
  // CryptoService 打桩：hmac 加 'h:' 前缀便于断言归一化后的取值
  const cryptoStub = {
    newCryptoId: (): string => 'a'.repeat(32),
    seal: (_purpose: string, plaintext: string | null | undefined): string | null =>
      plaintext ? 'v1.test.' + plaintext : null,
    open: (_purpose: string, token: string | null | undefined): string | null =>
      token ? token.replace('v1.test.', '') : null,
    hmac: (plaintext: string): string => 'h:' + plaintext,
  };

  let repository: UsersRepository;
  let service: UsersService;
  let findById: jest.SpyInstance;
  let findByUsername: jest.SpyInstance;
  let findByEmailHmac: jest.SpyInstance;
  let findByPhoneHmac: jest.SpyInstance;

  beforeEach(() => {
    repository = new UsersRepository();
    findById = jest.spyOn(repository, 'findById').mockResolvedValue(null);
    findByUsername = jest.spyOn(repository, 'findByUsername').mockResolvedValue(null);
    findByEmailHmac = jest.spyOn(repository, 'findByEmailHmac').mockResolvedValue(null);
    findByPhoneHmac = jest.spyOn(repository, 'findByPhoneHmac').mockResolvedValue(null);
    service = new UsersService(
      repository,
      cryptoStub as unknown as CryptoService,
      {} as unknown as UploadsService,
      {} as unknown as NotificationsService,
      {} as unknown as AuditLogService,
      {} as unknown as CaptchaService,
      { validate: async () => {} } as unknown as EmailCodeService,
      {} as unknown as RefreshTokenStore,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uuid 命中：直接走 findById，不再查 username/email/phone', async () => {
    const uuid = '01890a5d-ac96-7000-8000-000000000001';
    findById.mockResolvedValue(row());

    const result = await service.resolveRowByIdentifier(uuid);

    expect(result?.id).toBe(uuid);
    expect(findById).toHaveBeenCalledWith(uuid);
    expect(findByUsername).not.toHaveBeenCalled();
    expect(findByEmailHmac).not.toHaveBeenCalled();
    expect(findByPhoneHmac).not.toHaveBeenCalled();
  });

  it('email 形状直达 HMAC 查找（邮箱小写后取 hmac），不查 username', async () => {
    findByEmailHmac.mockResolvedValue(row());

    const result = await service.resolveRowByIdentifier('A@Example.com');

    expect(result?.id).toBe('01890a5d-ac96-7000-8000-000000000001');
    expect(findByEmailHmac).toHaveBeenCalledWith('h:a@example.com');
    expect(findByUsername).not.toHaveBeenCalled();
  });

  it('普通 handle 先查 username（历史 handle 命中即返回），不查 phone/email', async () => {
    findByUsername.mockResolvedValue(row({ username: 'old-handle' }));

    const result = await service.resolveRowByIdentifier('old-handle');

    expect(result?.username).toBe('old-handle');
    expect(findByUsername).toHaveBeenCalledWith('old-handle');
    expect(findByEmailHmac).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('纯数字 username 命中：username 优先，不查 phone', async () => {
    findByUsername.mockResolvedValue(row({ username: '12345' }));

    const result = await service.resolveRowByIdentifier('12345');

    expect(result?.username).toBe('12345');
    expect(findByUsername).toHaveBeenCalledWith('12345');
    expect(findByPhoneHmac).not.toHaveBeenCalled();
  });

  it('纯数字 username 未命中：再按手机号原样取 hmac 查', async () => {
    findByUsername.mockResolvedValue(null);
    findByPhoneHmac.mockResolvedValue(row({ phone: '13800138000' }));

    const result = await service.resolveRowByIdentifier('13800138000');

    expect(result?.phone).toBe('13800138000');
    expect(findByUsername).toHaveBeenCalledWith('13800138000');
    expect(findByPhoneHmac).toHaveBeenCalledWith('h:13800138000');
  });

  it('全未命中返回 null', async () => {
    const result = await service.resolveRowByIdentifier('nobody');

    expect(result).toBeNull();
    expect(findByUsername).toHaveBeenCalledWith('nobody');
    expect(findByEmailHmac).not.toHaveBeenCalled();
    expect(findByPhoneHmac).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('空串直接返回 null，不触发任何查询', async () => {
    expect(await service.resolveRowByIdentifier('   ')).toBeNull();
    expect(findById).not.toHaveBeenCalled();
    expect(findByUsername).not.toHaveBeenCalled();
    expect(findByEmailHmac).not.toHaveBeenCalled();
    expect(findByPhoneHmac).not.toHaveBeenCalled();
  });
});

/** 剔除 purge（v8.0 修复）deleteById：伪事务记录语句顺序，锁住四个顺序要点 */
describe('UsersRepository.deleteById', () => {
  /** 伪事务：select/子查询记录到 events，update 的 set 载荷单独记录 */
  function makeTx(role: string | null) {
    const events: string[] = [];
    const sets: Record<string, unknown>[] = [];
    const tableNames = new Map<unknown, string>([
      [users, 'users'],
      [attachments, 'attachments'],
      [taggings, 'taggings'],
      [articles, 'articles'],
      [announcements, 'announcements'],
      [resources, 'resources'],
      [assignments, 'assignments'],
      [assignmentSubmissions, 'submissions'],
      [issues, 'issues'],
    ]);
    const name = (table: unknown): string => tableNames.get(table) ?? 'unknown';
    const selectRows = role ? [{ role }] : [];

    const select = () => {
      const chain = {
        from: (table: unknown) => {
          events.push(`select:${name(table)}`);
          return chain;
        },
        where: () => chain,
        for: () => Promise.resolve(selectRows),
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
        // inArray 子查询桩：只需通过 isSQLWrapper，永不真正编译执行
        getSQL: () => sql`(select 1)`,
      };
      return chain;
    };
    const del = (table: unknown) => ({
      where: () => {
        events.push(`delete:${name(table)}`);
        return {
          returning: () => Promise.resolve([row()]),
          then: (
            resolve: (value: unknown[]) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        };
      },
    });
    const update = (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          events.push(`update:${name(table)}`);
          sets.push(values);
          return Promise.resolve([]);
        },
      }),
    });
    return { events, sets, select, delete: del, update };
  }

  function mockTx(role: string | null): ReturnType<typeof makeTx> {
    const tx = makeTx(role);
    jest
      .spyOn(db, 'transaction')
      .mockImplementation(((fn: (t: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(tx)) as unknown as typeof db.transaction);
    return tx;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('FOR UPDATE 校验不通过（目标不存在 / 角色变大）：返回 null 且不 purge', async () => {
    const repository = new UsersRepository();

    let tx = mockTx(null);
    expect(await repository.deleteById('u-1', 'admin-actor')).toBeNull();
    expect(tx.events).toEqual(['select:users']);

    tx = mockTx('ALUMNI');
    expect(await repository.deleteById('u-1', 'admin-actor')).toBeNull();
    expect(tx.events).toEqual(['select:users']);
  });

  it('purge 语义：taggings→内容→作业改派→作业删→提交删→删号，改派给执行者', async () => {
    const repository = new UsersRepository();
    const tx = mockTx(Role.MEMBER);

    const result = await repository.deleteById('u-1', 'admin-actor');

    // 顺序要点：①锁行最先 ②taggings 先于内容删除 ③改派先于作业删除 ④本人提交先于删号
    expect(tx.events).toEqual([
      'select:users',
      'select:attachments',
      'select:articles',
      'select:issues',
      'select:resources',
      'delete:taggings',
      'delete:articles',
      'delete:announcements',
      'delete:resources',
      'select:submissions',
      'update:assignments',
      'delete:assignments',
      'delete:submissions',
      'delete:users',
    ]);
    // 有他人提交的作业改派给执行剔除的管理员（reassignedPublisherTo）
    expect(tx.sets).toEqual([{ publisherId: 'admin-actor' }]);
    expect(result).toMatchObject({ id: '01890a5d-ac96-7000-8000-000000000001' });
  });
});
