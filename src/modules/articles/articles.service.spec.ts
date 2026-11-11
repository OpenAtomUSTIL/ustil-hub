import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
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
    insert: jest.fn(),
    update: jest.fn(),
    deleteById: jest.fn(),
  };
  const usersService = {
    getPublicByIds: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ArticlesService,
        { provide: ArticlesRepository, useValue: articlesRepository },
        { provide: UsersService, useValue: usersService },
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
  });

  it('ALUMNI 创建文章成功并返回详情', async () => {
    articlesRepository.insert.mockResolvedValue(row());

    const result = await service.create(
      { id: '01890a5d-ac96-7000-8000-000000000001', role: Role.ALUMNI },
      { title: '标题', content: '正文内容' },
    );

    expect(result.title).toBe('标题');
    expect(result.author.id).toBe('01890a5d-ac96-7000-8000-000000000001');
  });

  it('WHEEL 创建文章成功', async () => {
    articlesRepository.insert.mockResolvedValue(row());

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
});
