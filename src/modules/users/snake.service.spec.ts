import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { isValidStorageKey, STORAGE_SERVICE } from '../storage/storage.types';
import { generateSnakeSvgs } from './snake/generate-snake-svg';
import { UsersRepository } from './users.repository';
import { SnakeService } from './snake.service';

jest.mock('./snake/generate-snake-svg', () => ({
  generateSnakeSvgs: jest.fn(() => ({ light: '<svg>light</svg>', dark: '<svg>dark</svg>' })),
}));

describe('SnakeService', () => {
  let service: SnakeService;

  const usersRepository = {
    findByUsername: jest.fn(),
    getActivityParts: jest.fn(),
    listActiveUserIds: jest.fn(),
  };
  const storage = {
    put: jest.fn(),
    get: jest.fn(),
    getUrl: jest.fn(),
    remove: jest.fn(),
    stat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SnakeService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: STORAGE_SERVICE, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(SnakeService);
  });

  it('getSnakeSvg：用户名不存在 404', async () => {
    usersRepository.findByUsername.mockResolvedValue(null);

    await expect(service.getSnakeSvg('no-such-user', 'light')).rejects.toThrow(NotFoundException);
  });

  it('getSnakeSvg：返回预生成 SVG，key 为确定性 uuid', async () => {
    usersRepository.findByUsername.mockResolvedValue({ id: '01890a5d-ac96-7000-8000-000000000001' });
    storage.get.mockResolvedValue({ data: Buffer.from('<svg>dark</svg>', 'utf8'), contentType: 'image/svg+xml' });

    const result = await service.getSnakeSvg('gemini', 'dark');

    expect(result).toBe('<svg>dark</svg>');
    const key = storage.get.mock.calls[0][0] as string;
    expect(isValidStorageKey(key)).toBe(true);
    expect(key.endsWith('.svg')).toBe(true);
  });

  it('getSnakeSvg：未预生成 404', async () => {
    usersRepository.findByUsername.mockResolvedValue({ id: '01890a5d-ac96-7000-8000-000000000001' });
    storage.get.mockRejectedValue(new NotFoundException('文件不存在'));

    await expect(service.getSnakeSvg('gemini', 'light')).rejects.toThrow('贪吃蛇尚未生成');
  });

  it('generateForUser：写入深浅两套 SVG', async () => {
    usersRepository.getActivityParts.mockResolvedValue({
      articles: [],
      issues: [],
      replies: [],
      submissions: [],
      resources: [],
    });

    await service.generateForUser('01890a5d-ac96-7000-8000-000000000001');

    expect(generateSnakeSvgs).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledTimes(2);
    const keys = storage.put.mock.calls.map((c) => c[0] as string);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) expect(isValidStorageKey(key)).toBe(true);
    expect(storage.put.mock.calls.map((c) => c[2])).toEqual(['image/svg+xml', 'image/svg+xml']);
  });

  it('refreshAll：覆盖全部活跃用户', async () => {
    usersRepository.listActiveUserIds.mockResolvedValue(['u1', 'u2']);
    usersRepository.getActivityParts.mockResolvedValue({
      articles: [],
      issues: [],
      replies: [],
      submissions: [],
      resources: [],
    });

    const count = await service.refreshAll();

    expect(count).toBe(2);
    expect(usersRepository.getActivityParts).toHaveBeenCalledTimes(2);
    expect(storage.put).toHaveBeenCalledTimes(4);
  });
});
