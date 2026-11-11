import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '../../common/decorators/roles.decorator';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit/audit-log.service';
import { InviteCodesRepository } from './invite-codes.repository';
import { InviteCodesService } from './invite-codes.service';

const rowFixture = {
  id: '01890a5d-ac96-7000-8000-0000000000aa',
  code: 'ABCD2345EF',
  status: 'ACTIVE' as const,
  maxUses: 3,
  usedCount: 1,
  createdById: '01890a5d-ac96-7000-8000-000000000001',
  expiresAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('InviteCodesService', () => {
  let service: InviteCodesService;

  const repository = {
    insertMany: jest.fn(),
    findByCode: jest.fn(),
    findById: jest.fn(),
    list: jest.fn(),
    tryConsume: jest.fn(),
    release: jest.fn(),
    revoke: jest.fn(),
    countActive: jest.fn(),
  };
  const auditLogService = {
    record: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InviteCodesService,
        { provide: InviteCodesRepository, useValue: repository },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();
    service = moduleRef.get(InviteCodesService);
  });

  it('批量生成成功：返回码列表且含 remaining', async () => {
    repository.insertMany.mockResolvedValue([rowFixture, { ...rowFixture, id: 'id-2', code: 'FFFF2345GG' }]);

    const result = await service.generate({ id: 'actor-1', role: Role.ADMIN }, { count: 2, maxUses: 3 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].remaining).toBe(2);
    expect(repository.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ maxUses: 3, createdById: 'actor-1', expiresAt: null }),
      ]),
    );
  });

  it('核销成功：原子 +1', async () => {
    repository.findByCode.mockResolvedValue(rowFixture);
    repository.tryConsume.mockResolvedValue({ ...rowFixture, usedCount: 2 });

    const result = await service.consume('abcd2345ef');

    expect(result.id).toBe(rowFixture.id);
    expect(repository.findByCode).toHaveBeenCalledWith('ABCD2345EF');
    expect(repository.tryConsume).toHaveBeenCalledWith(rowFixture.id, expect.any(Date));
  });

  it('核销失败：不存在 / 作废 / 过期 / 用尽均 409', async () => {
    repository.findByCode.mockResolvedValue(null);
    await expect(service.consume('NOPE2345XX')).rejects.toThrow(ConflictException);

    repository.findByCode.mockResolvedValue({ ...rowFixture, status: 'REVOKED' });
    await expect(service.consume('ABCD2345EF')).rejects.toThrow('邀请码已作废');

    repository.findByCode.mockResolvedValue({
      ...rowFixture,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    await expect(service.consume('ABCD2345EF')).rejects.toThrow('邀请码已过期');

    repository.findByCode.mockResolvedValue(rowFixture);
    repository.tryConsume.mockResolvedValue(null);
    await expect(service.consume('ABCD2345EF')).rejects.toThrow('邀请码已被用尽');
  });

  it('作废失败：码不存在 404', async () => {
    repository.revoke.mockResolvedValue(null);
    await expect(service.revoke('missing-id', { id: 'actor-1', role: Role.ADMIN })).rejects.toThrow(NotFoundException);
  });

  it('生成与作废均写审计日志', async () => {
    repository.insertMany.mockResolvedValue([rowFixture]);
    await service.generate({ id: 'actor-1', role: Role.ADMIN }, { count: 1, maxUses: 3 });
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invite.create', targetType: 'INVITE_CODE' }),
    );

    repository.revoke.mockResolvedValue({ ...rowFixture, status: 'REVOKED' });
    await service.revoke(rowFixture.id, { id: 'actor-1', role: Role.ADMIN });
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invite.revoke', targetId: rowFixture.id }),
    );
  });
});
