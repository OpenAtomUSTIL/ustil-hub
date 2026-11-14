import { Role } from '../../common/decorators/roles.decorator';
import { UserStatus } from '../../db/schema';
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
