import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { AnnouncementsService } from '../announcements/announcements.service';
import { ArticlesService } from '../articles/articles.service';
import { IssuesService } from '../issues/issues.service';
import { ResourcesService } from '../resources/resources.service';
import { TrashService } from './trash.service';

const deletedAt = new Date('2026-01-02T00:00:00.000Z');
const now = new Date('2026-01-01T00:00:00.000Z');

describe('TrashService', () => {
  let service: TrashService;

  const articlesService = {
    listDeleted: jest.fn(),
    restore: jest.fn(),
  };
  const announcementsService = {
    listDeleted: jest.fn(),
    restore: jest.fn(),
  };
  const resourcesService = {
    listDeleted: jest.fn(),
    restore: jest.fn(),
  };
  const issuesService = {
    listDeletedReplies: jest.fn(),
    restoreReply: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrashService,
        { provide: ArticlesService, useValue: articlesService },
        { provide: AnnouncementsService, useValue: announcementsService },
        { provide: ResourcesService, useValue: resourcesService },
        { provide: IssuesService, useValue: issuesService },
      ],
    }).compile();
    service = moduleRef.get(TrashService);
    articlesService.listDeleted.mockResolvedValue({ rows: [], total: 0 });
    announcementsService.listDeleted.mockResolvedValue({ rows: [], total: 0 });
    resourcesService.listDeleted.mockResolvedValue({ rows: [], total: 0 });
    issuesService.listDeletedReplies.mockResolvedValue({ rows: [], total: 0 });
  });

  it('按 type=ARTICLE 过滤：映射 TrashItem 含 original 快照', async () => {
    articlesService.listDeleted.mockResolvedValue({
      rows: [
        {
          id: '01890a5d-ac96-7000-8000-0000000000a1',
          title: '文章标题',
          content: '文章正文',
          authorId: 'u-1',
          deletedAt,
          createdAt: now,
          updatedAt: now,
        },
      ],
      total: 1,
    });

    const result = await service.list(
      { page: 1, pageSize: 20, type: 'ARTICLE' },
      { id: 'admin-1', role: Role.ADMIN },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: '01890a5d-ac96-7000-8000-0000000000a1',
      type: 'ARTICLE',
      title: '文章标题',
      summary: '文章正文',
      deletedAt: deletedAt.toISOString(),
      original: { title: '文章标题', content: '文章正文', authorId: 'u-1' },
    });
    expect(announcementsService.listDeleted).not.toHaveBeenCalled();
  });

  it('不带 type：四类合并按 deletedAt desc 分页', async () => {
    articlesService.listDeleted.mockResolvedValue({
      rows: [
        {
          id: 'a-1',
          title: 'A',
          content: 'a',
          authorId: 'u-1',
          deletedAt: new Date('2026-01-03T00:00:00.000Z'),
          createdAt: now,
          updatedAt: now,
        },
      ],
      total: 1,
    });
    issuesService.listDeletedReplies.mockResolvedValue({
      rows: [
        {
          id: 'c-1',
          issueId: 'i-1',
          issueTitle: '问题',
          authorId: 'u-2',
          content: '评论内容',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          deletedAt: '2026-01-05T00:00:00.000Z',
        },
      ],
      total: 1,
    });

    const result = await service.list({ page: 1, pageSize: 20 }, { id: 'admin-1', role: Role.ADMIN });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(['c-1', 'a-1']);
    expect(result.items[0].type).toBe('COMMENT');
  });

  it('restore 按 type 分发到对应 service', async () => {
    await service.restore('ARTICLE', 'a-1', { id: 'wheel-1', role: Role.WHEEL });
    await service.restore('ANNOUNCEMENT', 'n-1', { id: 'wheel-1', role: Role.WHEEL });
    await service.restore('RESOURCE', 'r-1', { id: 'wheel-1', role: Role.WHEEL });
    await service.restore('COMMENT', 'c-1', { id: 'wheel-1', role: Role.WHEEL });

    expect(articlesService.restore).toHaveBeenCalledWith('a-1', expect.objectContaining({ role: Role.WHEEL }));
    expect(announcementsService.restore).toHaveBeenCalledWith('n-1', expect.anything());
    expect(resourcesService.restore).toHaveBeenCalledWith('r-1', expect.anything());
    expect(issuesService.restoreReply).toHaveBeenCalledWith('c-1', expect.anything());
  });
});
