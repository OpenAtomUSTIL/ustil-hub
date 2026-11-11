import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { TagsService } from '../tags/tags.service';
import { UsersService } from '../users/users.service';
import { ArticlesRepository, ArticleRow } from './articles.repository';
import { ArticlesService } from './articles.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function row(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: '01890a5d-ac96-7000-8000-0000000000a1',
    title: '标题',
    content: '正文内容',
    authorId: '01890a5d-ac96-7000-8000-000000000001',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ArticleRow;
}

describe('ArticlesService', () => {
  let service: ArticlesService;

  const articlesRepository = {
    list: jest.fn(),
    findById: jest.fn(),
    findByIdIncludingDeleted: jest.fn(),
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
    const moduleRef = await Test.createTestingModule({
      providers: [
        ArticlesService,
        { provide: ArticlesRepository, useValue: articlesRepository },
        { provide: UsersService, useValue: usersService },
        { provide: TagsService, useValue: tagsService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();
    service = moduleRef.get(ArticlesService);
    usersService.getPublicByIds.mockResolvedValue(
      new Map([
        [
          '01890a5d-ac96-7000-8000-000000000001',
          {
            id: '01890a5d-ac96-7000-8000-000000000001',
            nickname: '作者',
            avatarUrl: null,
            role: Role.ALUMNI,
          },
        ],
      ]),
    );
    tagsService.getNamesByTargets.mockResolvedValue(new Map([['01890a5d-ac96-7000-8000-0000000000a1', ['tag-a']]]));
  });

  it('ALUMNI 创建文章成功并返回详情', async () => {
    articlesRepository.insert.mockResolvedValue(row());
    articlesRepository.findById.mockResolvedValue(row());

    const result = await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
      { title: '标题', content: '正文内容' },
    );

    expect(result.title).toBe('标题');
    expect(result.tags).toEqual(['tag-a']);
    expect(result.author.id).toBe('01890a5d-ac96-7000-8000-000000000001');
  });

  it('创建文章写入标签与审计日志', async () => {
    articlesRepository.insert.mockResolvedValue(row());
    articlesRepository.findById.mockResolvedValue(row());

    await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
      { title: '标题', content: '正文内容', tags: ['Tag-A'] },
    );

    expect(tagsService.syncTags).toHaveBeenCalledWith('ARTICLE', '01890a5d-ac96-7000-8000-0000000000a1', ['Tag-A']);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'article.create', targetId: '01890a5d-ac96-7000-8000-0000000000a1' }),
    );
  });

  it('列表按 authorId 与 tag 过滤', async () => {
    articlesRepository.list.mockResolvedValue({ rows: [row()], total: 1 });
    tagsService.findTargetIds.mockResolvedValue(['01890a5d-ac96-7000-8000-0000000000a1']);

    await service.list({
      page: 1,
      pageSize: 20,
      authorId: '01890a5d-ac96-7000-8000-000000000001',
      tag: 'tag-a',
    });

    expect(tagsService.findTargetIds).toHaveBeenCalledWith('ARTICLE', 'tag-a');
    expect(articlesRepository.list).toHaveBeenCalledWith(1, 20, {
      keyword: undefined,
      authorId: '01890a5d-ac96-7000-8000-000000000001',
      tagTargetIds: ['01890a5d-ac96-7000-8000-0000000000a1'],
    });
  });

  it('WHEEL 创建文章成功', async () => {
    articlesRepository.insert.mockResolvedValue(row());
    articlesRepository.findById.mockResolvedValue(row());

    const result = await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
      { title: '标题', content: '正文内容' },
    );

    expect(result.title).toBe('标题');
    expect(articlesRepository.insert).toHaveBeenCalled();
  });

  it('MEMBER 创建文章返回 403', async () => {
    await expect(
      service.create(
        { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER },
        { title: '标题', content: '正文内容' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(articlesRepository.insert).not.toHaveBeenCalled();
  });

  it('非作者本人编辑文章返回 403', async () => {
    articlesRepository.findById.mockResolvedValue(row());

    await expect(
      service.update(
        '01890a5d-ac96-7000-8000-0000000000a1',
        { id: 'someone-else', role: Role.ALUMNI },
        { title: '新标题' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(articlesRepository.update).not.toHaveBeenCalled();
  });

  it('删除文章为软删除：保留 taggings 并写 before 快照审计', async () => {
    articlesRepository.findById.mockResolvedValue(row());

    await service.remove(
      '01890a5d-ac96-7000-8000-0000000000a1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
    );

    expect(articlesRepository.softDeleteById).toHaveBeenCalled();
    expect(tagsService.cleanup).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'article.delete',
        detail: { title: '标题', content: '正文内容' },
      }),
    );
  });

  it('软删详情返回 404（findById 排除软删行）', async () => {
    articlesRepository.findById.mockResolvedValue(null);

    await expect(service.getDetail('01890a5d-ac96-7000-8000-0000000000a1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('WHEEL 恢复回收站文章并写审计', async () => {
    articlesRepository.findByIdIncludingDeleted.mockResolvedValue(row({ deletedAt: now }));

    await service.restore('01890a5d-ac96-7000-8000-0000000000a1', {
      id: 'wheel-1',
      role: Role.WHEEL,
    });

    expect(articlesRepository.restoreById).toHaveBeenCalledWith('01890a5d-ac96-7000-8000-0000000000a1');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'article.restore' }),
    );
  });

  it('重复恢复（未软删）返回 409', async () => {
    articlesRepository.findByIdIncludingDeleted.mockResolvedValue(row());

    await expect(
      service.restore('01890a5d-ac96-7000-8000-0000000000a1', { id: 'wheel-1', role: Role.WHEEL }),
    ).rejects.toThrow(ConflictException);
    expect(articlesRepository.restoreById).not.toHaveBeenCalled();
  });

  it('恢复不存在的文章返回 404', async () => {
    articlesRepository.findByIdIncludingDeleted.mockResolvedValue(null);

    await expect(
      service.restore('01890a5d-ac96-7000-8000-0000000000a1', { id: 'wheel-1', role: Role.WHEEL }),
    ).rejects.toThrow(NotFoundException);
  });

  it('MEMBER 恢复返回 403', async () => {
    await expect(
      service.restore('01890a5d-ac96-7000-8000-0000000000a1', { id: 'm-1', role: Role.MEMBER }),
    ).rejects.toThrow(ForbiddenException);
  });
});
