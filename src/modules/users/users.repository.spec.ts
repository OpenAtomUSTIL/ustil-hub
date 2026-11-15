import { sql } from 'drizzle-orm';
import { Role } from '../../common/decorators/roles.decorator';
import { db } from '../../db';
import {
  announcements,
  articles,
  assignmentSubmissions,
  assignments,
  issues,
  resources,
  taggings,
  UserStatus,
  users,
} from '../../db/schema';
import { UsersRepository, UserRow } from './users.repository';

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

/** 解析式寻址（v6.0）findByIdentifier：uuid → username（含历史 handle）→ email → phone */
describe('UsersRepository.findByIdentifier', () => {
  let repository: UsersRepository;
  let findById: jest.SpyInstance;
  let findByUsername: jest.SpyInstance;
  let findByEmailOrPhone: jest.SpyInstance;

  beforeEach(() => {
    repository = new UsersRepository();
    findById = jest.spyOn(repository, 'findById').mockResolvedValue(null);
    findByUsername = jest.spyOn(repository, 'findByUsername').mockResolvedValue(null);
    findByEmailOrPhone = jest.spyOn(repository, 'findByEmailOrPhone').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uuid 命中：直接走 findById，不再查 username/email/phone', async () => {
    const uuid = '01890a5d-ac96-7000-8000-000000000001';
    findById.mockResolvedValue(row());

    const result = await repository.findByIdentifier(uuid);

    expect(result?.id).toBe(uuid);
    expect(findById).toHaveBeenCalledWith(uuid);
    expect(findByUsername).not.toHaveBeenCalled();
    expect(findByEmailOrPhone).not.toHaveBeenCalled();
  });

  it('email 形状直达 findByEmailOrPhone（传入小写），不查 username', async () => {
    findByEmailOrPhone.mockResolvedValue(row());

    const result = await repository.findByIdentifier('A@Example.com');

    expect(result?.id).toBe('01890a5d-ac96-7000-8000-000000000001');
    expect(findByEmailOrPhone).toHaveBeenCalledWith('a@example.com');
    expect(findByUsername).not.toHaveBeenCalled();
  });

  it('普通 handle 先查 username（历史 handle 命中即返回），不查 phone/email', async () => {
    findByUsername.mockResolvedValue(row({ username: 'old-handle' }));

    const result = await repository.findByIdentifier('old-handle');

    expect(result?.username).toBe('old-handle');
    expect(findByUsername).toHaveBeenCalledWith('old-handle');
    expect(findByEmailOrPhone).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('纯数字 username 命中：username 优先，不查 phone', async () => {
    findByUsername.mockResolvedValue(row({ username: '12345' }));

    const result = await repository.findByIdentifier('12345');

    expect(result?.username).toBe('12345');
    expect(findByUsername).toHaveBeenCalledWith('12345');
    expect(findByEmailOrPhone).not.toHaveBeenCalled();
  });

  it('纯数字 username 未命中：再按手机号查 findByEmailOrPhone', async () => {
    findByUsername.mockResolvedValue(null);
    findByEmailOrPhone.mockResolvedValue(row({ phone: '13800138000' }));

    const result = await repository.findByIdentifier('13800138000');

    expect(result?.phone).toBe('13800138000');
    expect(findByUsername).toHaveBeenCalledWith('13800138000');
    expect(findByEmailOrPhone).toHaveBeenCalledWith('13800138000');
  });

  it('全未命中返回 null', async () => {
    const result = await repository.findByIdentifier('nobody');

    expect(result).toBeNull();
    expect(findByUsername).toHaveBeenCalledWith('nobody');
    expect(findByEmailOrPhone).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('空串直接返回 null，不触发任何查询', async () => {
    expect(await repository.findByIdentifier('   ')).toBeNull();
    expect(findById).not.toHaveBeenCalled();
    expect(findByUsername).not.toHaveBeenCalled();
    expect(findByEmailOrPhone).not.toHaveBeenCalled();
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
