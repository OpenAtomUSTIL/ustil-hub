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
    slug: '标题',
    title: '标题',
    content: '正文内容',
    authorId: '01890a5d-ac96-7000-8000-000000000001',
    status: 'PUBLISHED',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ArticleRow;
}

const transaction = {};

describe('ArticlesService', () => {
  let service: ArticlesService;

  const articlesRepository = {
    withArticleLock: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    findByIdIncludingDeleted: jest.fn(),
    findByIdOrSlug: jest.fn(),
    slugExists: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
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
    articlesRepository.withArticleLock.mockImplementation((id, operation) => articlesRepository.findById(id).then((row: ArticleRow | null) => operation(row, transaction)));
    articlesRepository.slugExists.mockResolvedValue(false);
    articlesRepository.findByIdOrSlug.mockImplementation((v) => articlesRepository.findById(v));
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
    expect(result.status).toBe('PUBLISHED');
  });

  it('MEMBER 创建文章成功，状态为 PENDING', async () => {
    articlesRepository.insert.mockResolvedValue(row({ status: 'PENDING' }));
    articlesRepository.findById.mockResolvedValue(row({ status: 'PENDING' }));

    const result = await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER },
      { title: '标题', content: '正文内容' },
    );

    expect(result.title).toBe('标题');
    expect(result.status).toBe('PENDING');
    expect(articlesRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING' }),
    );
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
      status: 'PUBLISHED',
    });
  });

  it('公开列表只查 PUBLISHED', async () => {
    articlesRepository.list.mockResolvedValue({ rows: [row()], total: 1 });
    tagsService.findTargetIds.mockResolvedValue(undefined);

    await service.list({ page: 1, pageSize: 20 });

    expect(articlesRepository.list).toHaveBeenCalledWith(1, 20, {
      keyword: undefined,
      authorId: undefined,
      tagTargetIds: undefined,
      status: 'PUBLISHED',
    });
  });

  it('摘要按块截取：HTML 块保整、文本块按长度截断、纯文本不加省略号', async () => {
    const longText = '文'.repeat(200);
    articlesRepository.list.mockResolvedValue({
      rows: [
        row({ content: `<div align="center"><img src="https://x/banner.png"></div>\n\n${longText}` }),
        row({ content: 'a < b 与 c' }),
      ],
      total: 2,
    });
    tagsService.findTargetIds.mockResolvedValue(undefined);

    const result = await service.list({ page: 1, pageSize: 20 });

    const [first, second] = result.items;
    expect(first.excerpt.startsWith('<div align="center"><img src="https://x/banner.png"></div>')).toBe(true);
    expect(first.excerpt.endsWith('…')).toBe(true);
    expect(second.excerpt).toBe('a < b 与 c');
  });

  it('摘要不残留半截 HTML 标签', async () => {
    articlesRepository.list.mockResolvedValue({
      rows: [row({ content: `${'文'.repeat(110)}<img src="https://x/a.png">尾巴` })],
      total: 1,
    });
    tagsService.findTargetIds.mockResolvedValue(undefined);

    const result = await service.list({ page: 1, pageSize: 20 });

    const excerpt = result.items[0].excerpt;
    expect(excerpt).not.toContain('<img');
    expect(excerpt.endsWith('…')).toBe(true);
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

  it('MEMBER 编辑自己的 PENDING 文章成功', async () => {
    articlesRepository.findById.mockResolvedValue(row({ status: 'PENDING' }));
    articlesRepository.update.mockResolvedValue(row({ status: 'PENDING', title: '新标题' }));

    await service.update(
      '01890a5d-ac96-7000-8000-0000000000a1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER },
      { title: '新标题' },
    );

    expect(articlesRepository.update).toHaveBeenCalled();
  });

  it('MEMBER 编辑自己的 PUBLISHED 文章返回 403', async () => {
    articlesRepository.findById.mockResolvedValue(row({ status: 'PUBLISHED' }));

    await expect(
      service.update(
        '01890a5d-ac96-7000-8000-0000000000a1',
        { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER },
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

  it('MEMBER 删除自己的 PENDING 文章成功', async () => {
    articlesRepository.findById.mockResolvedValue(row({ status: 'PENDING' }));

    await service.remove(
      '01890a5d-ac96-7000-8000-0000000000a1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER },
    );

    expect(articlesRepository.softDeleteById).toHaveBeenCalled();
  });

  it('MEMBER 删除自己的 PUBLISHED 文章返回 403', async () => {
    articlesRepository.findById.mockResolvedValue(row({ status: 'PUBLISHED' }));

    await expect(
      service.remove(
        '01890a5d-ac96-7000-8000-0000000000a1',
        { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(articlesRepository.softDeleteById).not.toHaveBeenCalled();
  });

  // ===== 审核 =====

  it('WHEEL 审核通过 PENDING 文章', async () => {
    articlesRepository.findById
      .mockResolvedValueOnce(row({ status: 'PENDING' }))
      .mockResolvedValueOnce(row({ status: 'PUBLISHED' }));
    articlesRepository.updateStatus.mockResolvedValue(row({ status: 'PUBLISHED' }));

    const result = await service.review(
      '01890a5d-ac96-7000-8000-0000000000a1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
      'approve',
    );

    expect(result.status).toBe('PUBLISHED');
    expect(articlesRepository.updateStatus).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-0000000000a1',
      'PUBLISHED',
      '01890a5d-ac96-7000-8000-000000000001',
      undefined,
      transaction,
    );
  });

  it('WHEEL 拒绝 PENDING 文章并附备注', async () => {
    articlesRepository.findById
      .mockResolvedValueOnce(row({ status: 'PENDING' }))
      .mockResolvedValueOnce(row({ status: 'REJECTED', reviewNote: '内容违规' }));
    articlesRepository.updateStatus.mockResolvedValue(row({ status: 'REJECTED' }));

    const result = await service.review(
      '01890a5d-ac96-7000-8000-0000000000a1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ADMIN },
      'reject',
      '内容违规',
    );

    expect(result.status).toBe('REJECTED');
    expect(result.reviewNote).toBe('内容违规');
  });

  it('WHEEL 隐藏已发布文章（先发后审）', async () => {
    articlesRepository.findById
      .mockResolvedValueOnce(row({ status: 'PUBLISHED' }))
      .mockResolvedValueOnce(row({ status: 'HIDDEN' }));
    articlesRepository.updateStatus.mockResolvedValue(row({ status: 'HIDDEN' }));

    const result = await service.review(
      '01890a5d-ac96-7000-8000-0000000000a1',
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
      'hide',
    );

    expect(result.status).toBe('HIDDEN');
  });

  it('approve 仅对 PENDING 文章有效', async () => {
    articlesRepository.findById.mockResolvedValue(row({ status: 'PUBLISHED' }));

    await expect(
      service.review(
        '01890a5d-ac96-7000-8000-0000000000a1',
        { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.WHEEL },
        'approve',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('MEMBER 调用审核接口返回 403', async () => {
    await expect(
      service.review(
        '01890a5d-ac96-7000-8000-0000000000a1',
        { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.MEMBER },
        'approve',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('非 PUBLISHED 文章对非作者不可见', async () => {
    articlesRepository.findById.mockResolvedValue(row({ status: 'PENDING' }));

    await expect(
      service.getDetail('01890a5d-ac96-7000-8000-0000000000a1', {
        id: 'someone-else',
        role: Role.ALUMNI,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('作者可查看自己的 PENDING 文章', async () => {
    articlesRepository.findById.mockResolvedValue(row({ status: 'PENDING' }));

    const result = await service.getDetail('01890a5d-ac96-7000-8000-0000000000a1', {
      id: '01890a5d-ac96-7000-8000-000000000001',
      role: Role.MEMBER,
    });

    expect(result.status).toBe('PENDING');
  });
  it('列表按完整正文计算阅读时长，不能按截断摘要计算', async () => {
    articlesRepository.list.mockResolvedValue({ rows: [row({ content: '中'.repeat(601) })], total: 1 });
    tagsService.getNamesByTargets.mockResolvedValue(new Map());
    const result = await service.list({ page: 1, pageSize: 20 });
    expect(result.items[0]).toEqual(expect.objectContaining({ readingMinutes: 3 }));
  });

  it('详情反映最新正文的阅读时长', async () => {
    articlesRepository.findById.mockResolvedValue(row({ content: 'word '.repeat(401) }));
    tagsService.getNamesByTargets.mockResolvedValue(new Map());
    const result = await service.getDetail('01890a5d-ac96-7000-8000-0000000000a1');
    expect(result).toEqual(expect.objectContaining({ readingMinutes: 3 }));
  });

});
