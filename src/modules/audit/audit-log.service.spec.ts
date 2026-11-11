import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;

  const repository = {
    insert: jest.fn(),
    list: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AuditLogService, { provide: AuditLogRepository, useValue: repository }],
    }).compile();
    service = moduleRef.get(AuditLogService);
  });

  it('record 落库 actor 快照与 detail', async () => {
    await service.record({
      actor: { id: 'actor-1', role: Role.ADMIN, email: 'admin@example.com' },
      action: 'user.ban',
      targetType: 'USER',
      targetId: 'u-1',
      detail: { from: 'ACTIVE', to: 'BANNED' },
    });

    expect(repository.insert).toHaveBeenCalledWith({
      actorId: 'actor-1',
      actorEmail: 'admin@example.com',
      action: 'user.ban',
      targetType: 'USER',
      targetId: 'u-1',
      detail: { from: 'ACTIVE', to: 'BANNED' },
    });
  });

  it('写库失败不抛出（失败静默）', async () => {
    repository.insert.mockRejectedValue(new Error('db down'));
    await expect(
      service.record({ actor: { id: 'actor-1', role: Role.ADMIN }, action: 'a', targetType: 'T' }),
    ).resolves.toBeUndefined();
  });
});
