import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { TagsService } from '../tags/tags.service';
import { UsersService } from '../users/users.service';
import { ResourceRow, ResourcesRepository } from './resources.repository';
import { ResourcesService } from './resources.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function row(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000r1',
    slug: 'drizzle-文档',
    title: 'Drizzle 文档',
    description: 'ORM 文档',
    url: 'https://orm.drizzle.team',
    category: 'DOCUMENT',
    creatorId: '01890a5d-ac96-7000-8000-000000000001',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ResourceRow;
}

describe('ResourcesService', () => {
  let service: ResourcesService;

  const resourcesRepository = {
    list: jest.fn(),
    findById: jest.fn(),
    findByIdIncludingDeleted: jest.fn(),
    findByIdOrSlug: jest.fn(),
    slugExists: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    softDeleteById: jest.fn(),
    listDeleted: jest.fn(),
    restoreById: jest.fn(),
  };
  const usersService = {
    getPublicByIds: jest.fn(),
  };
  const tagsService = {
    normalizeTags: jest.fn((tags?: string[]) => tags),
    syncTags: jest.fn(),
    cleanup: jest.fn(),
    getNamesByTargets: jest.fn(),
    findTargetIds: jest.fn(),
  };
  const auditLogService = {
    record: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    resourcesRepository.slugExists.mockResolvedValue(false);
    resourcesRepository.findByIdOrSlug.mockImplementation((v) => resourcesRepository.findById(v));
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResourcesService,
        { provide: ResourcesRepository, useValue: resourcesRepository },
        { provide: UsersService, useValue: usersService },
        { provide: TagsService, useValue: tagsService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();
    service = moduleRef.get(ResourcesService);
    usersService.getPublicByIds.mockResolvedValue(
      new Map([
        [
          '01890a5d-ac96-7000-8000-000000000001',
          {
            id: '01890a5d-ac96-7000-8000-000000000001',
            nickname: '负责人',
            avatarUrl: null,
            role: Role.WHEEL,
          },
        ],
      ]),
    );
    tagsService.getNamesByTargets.mockResolvedValue(new Map([['01890a5d-ac96-7000-8000-0000000000r1', ['docs']]]));
  });

  it('WHEEL 创建资源成功，返回含 tags 的 ResourceItem', async () => {
    resourcesRepository.insert.mockResolvedValue(row());
    resourcesRepository.findById.mockResolvedValue(row());

    const result = await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
      {
        title: 'Drizzle 文档',
        description: 'ORM 文档',
        url: 'https://orm.drizzle.team',
        category: 'DOCUMENT',
        tags: ['docs'],
      },
    );

    expect(result.tags).toEqual(['docs']);
    expect(result.creatorName).toBe('负责人');
    expect(tagsService.syncTags).toHaveBeenCalledWith(
      'RESOURCE',
      '01890a5d-ac96-7000-8000-0000000000r1',
      ['docs'],
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resource.create' }),
    );
  });

  it('MEMBER 创建资源返回 403', async () => {
    await expect(
      service.create(
        { id: '01890a5d-ac96-7000-8000-000000000002', role: Role.MEMBER },
        { title: '标题', url: 'https://example.com', category: 'OTHER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(resourcesRepository.insert).not.toHaveBeenCalled();
  });

  it('非创建者且非 ADMIN 编辑资源返回 403', async () => {
    resourcesRepository.findById.mockResolvedValue(row());

    await expect(
      service.update(
        '01890a5d-ac96-7000-8000-0000000000r1',
        { id: 'someone-else', role: Role.WHEEL },
        { title: '新标题' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(resourcesRepository.update).not.toHaveBeenCalled();
  });

  it('删除资源为软删除：保留 taggings 并写 before 快照审计', async () => {
    resourcesRepository.findById.mockResolvedValue(row());

    await service.remove('01890a5d-ac96-7000-8000-0000000000r1', {
      id: '01890a5d-ac96-7000-8000-000000000001',
      role: Role.WHEEL,
    });

    expect(resourcesRepository.softDeleteById).toHaveBeenCalled();
    expect(tagsService.cleanup).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resource.delete' }),
    );
  });

  it('WHEEL 恢复回收站资源并写审计；重复恢复返回 409', async () => {
    const deleted = { ...row(), deletedAt: new Date('2026-01-02T00:00:00.000Z') };
    resourcesRepository.findByIdIncludingDeleted.mockResolvedValue(deleted);

    await service.restore('01890a5d-ac96-7000-8000-0000000000r1', {
      id: 'wheel-1',
      role: Role.WHEEL,
    });
    expect(resourcesRepository.restoreById).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-0000000000r1');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resource.restore' }),
    );

    resourcesRepository.findByIdIncludingDeleted.mockResolvedValue(row());
    await expect(
      service.restore('01890a5d-ac96-7000-8000-0000000000r1', { id: 'wheel-1', role: Role.WHEEL }),
    ).rejects.toThrow(ConflictException);
  });

  it('按 tag 过滤：标签无引用时返回空页', async () => {
    tagsService.findTargetIds.mockResolvedValue([]);
    resourcesRepository.list.mockResolvedValue({ rows: [], total: 0 });

    const result = await service.list({ page: 1, pageSize: 20, tag: 'nope' });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(resourcesRepository.list).toHaveBeenCalledWith(1, 20, {
      category: undefined,
      keyword: undefined,
      tagTargetIds: [],
    });
  });
});
