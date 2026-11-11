import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TagsRepository } from './tags.repository';
import { TagsService } from './tags.service';

describe('TagsService', () => {
  let service: TagsService;

  const repository = {
    listWithCounts: jest.fn(),
    findTargetIds: jest.fn(),
    findNamesByTargets: jest.fn(),
    syncTaggings: jest.fn(),
    deleteTaggings: jest.fn(),
    deleteIssueTaggingsOfAuthor: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [TagsService, { provide: TagsRepository, useValue: repository }],
    }).compile();
    service = moduleRef.get(TagsService);
  });

  it('normalizeTags：trim、小写、大小写不敏感去重', () => {
    expect(service.normalizeTags([' React ', 'react', 'VUE', 'vue.js'])).toEqual([
      'react',
      'vue',
      'vue.js',
    ]);
    expect(service.normalizeTags(undefined)).toBeUndefined();
    expect(service.normalizeTags([])).toEqual([]);
  });

  it('normalizeTags：空标签返回 400', () => {
    expect(() => service.normalizeTags(['  '])).toThrow(BadRequestException);
    expect(() => service.normalizeTags([''])).toThrow(BadRequestException);
  });

  it('syncTags 透传已规范化名称', async () => {
    await service.syncTags('ARTICLE', 'a-1', ['react']);
    expect(repository.syncTaggings).toHaveBeenCalledWith('ARTICLE', 'a-1', ['react']);
  });

  it('findTargetIds 大小写不敏感精确匹配', async () => {
    repository.findTargetIds.mockResolvedValue(['a-1']);

    const ids = await service.findTargetIds('ARTICLE', ' React ');

    expect(repository.findTargetIds).toHaveBeenCalledWith('ARTICLE', 'react');
    expect(ids).toEqual(['a-1']);
  });

  it('list 返回 count 倒序视图', async () => {
    repository.listWithCounts.mockResolvedValue([
      { id: 't-1', name: 'react', count: 5 },
      { id: 't-2', name: 'vue', count: 2 },
    ]);

    const result = await service.list();

    expect(result).toEqual([
      { id: 't-1', name: 'react', count: 5 },
      { id: 't-2', name: 'vue', count: 2 },
    ]);
  });

  it('cleanup 与 cleanupIssuesOfAuthor 透传仓库', async () => {
    await service.cleanup('ISSUE', 'i-1');
    expect(repository.deleteTaggings).toHaveBeenCalledWith('ISSUE', 'i-1');

    await service.cleanupIssuesOfAuthor('u-1');
    expect(repository.deleteIssueTaggingsOfAuthor).toHaveBeenCalledWith('u-1');
  });
});
