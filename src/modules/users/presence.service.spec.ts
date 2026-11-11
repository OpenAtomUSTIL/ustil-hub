import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { UsersRepository } from './users.repository';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let service: PresenceService;

  const usersRepository = {
    touchLastSeen: jest.fn(),
    listLastSeenSince: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: UsersRepository, useValue: usersRepository },
      ],
    }).compile();
    service = moduleRef.get(PresenceService);
    usersRepository.touchLastSeen.mockResolvedValue(undefined);
  });

  it('同一用户 60 秒内只更新一次 last_seen_at', () => {
    service.touch('u-1');
    service.touch('u-1');
    service.touch('u-1');

    expect(usersRepository.touchLastSeen).toHaveBeenCalledTimes(1);

    service.touch('u-2');
    expect(usersRepository.touchLastSeen).toHaveBeenCalledTimes(2);
  });

  it('更新失败静默不抛出', async () => {
    usersRepository.touchLastSeen.mockRejectedValue(new Error('db down'));

    expect(() => service.touch('u-1')).not.toThrow();
    // 等待微任务结算，确保未处理 rejection 不会冒泡
    await new Promise((resolve) => setImmediate(resolve));
    expect(usersRepository.touchLastSeen).toHaveBeenCalledTimes(1);
  });

  it('在线用户列表按 lastSeenAt desc 返回', async () => {
    const lastSeenAt = new Date('2026-01-01T00:10:00.000Z');
    usersRepository.listLastSeenSince.mockResolvedValue([
      {
        id: 'u-1',
        email: 'a@example.com',
        nickname: '甲',
        role: 'MEMBER',
        lastSeenAt,
      },
    ]);

    const result = await service.listOnline(15, { id: 'admin-1', role: Role.ADMIN });

    expect(result.minutes).toBe(15);
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        userId: 'u-1',
        email: 'a@example.com',
        nickname: '甲',
        role: Role.MEMBER,
        lastSeenAt: lastSeenAt.toISOString(),
      },
    ]);
  });

  it('MEMBER 查询在线用户返回 403', async () => {
    await expect(service.listOnline(15, { id: 'm-1', role: Role.MEMBER })).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersRepository.listLastSeenSince).not.toHaveBeenCalled();
  });
});
