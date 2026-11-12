import { BadRequestException, Injectable } from '@nestjs/common';
import { TagTargetType } from '../../db/schema';
import { TagsRepository } from './tags.repository';
import { TagView } from './tags.views';

@Injectable()
export class TagsService {
  constructor(private readonly tagsRepository: TagsRepository) {}

  // 校验并规范化标签：trim、小写、大小写不敏感去重；非法（空标签）400
  normalizeTags(tags: unknown): string[] | undefined {
    if (tags === undefined) {
      return undefined;
    }
    if (!Array.isArray(tags)) {
      throw new BadRequestException('tags 必须是数组');
    }
    const seen = new Set<string>();
    const names: string[] = [];
    for (const item of tags) {
      if (typeof item !== 'string') {
        throw new BadRequestException('tags 项必须是字符串');
      }
      const name = item.trim().toLowerCase();
      if (!name) {
        throw new BadRequestException('标签不能为空');
      }
      if (name.length > 30) {
        throw new BadRequestException('标签不能超过 30 个字符');
      }
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }

  async syncTags(targetType: TagTargetType, targetId: string, names: string[]): Promise<void> {
    await this.tagsRepository.syncTaggings(targetType, targetId, names);
  }

  async cleanup(targetType: TagTargetType, targetId: string): Promise<void> {
    await this.tagsRepository.deleteTaggings(targetType, targetId);
  }

  async cleanupIssuesOfAuthor(authorId: string): Promise<void> {
    await this.tagsRepository.deleteIssueTaggingsOfAuthor(authorId);
  }

  async getNamesByTargets(
    targetType: TagTargetType,
    targetIds: string[],
  ): Promise<Map<string, string[]>> {
    return this.tagsRepository.findNamesByTargets(targetType, targetIds);
  }

  /** 精确匹配标签名（大小写不敏感）；标签不存在返回空数组 */
  async findTargetIds(targetType: TagTargetType, name: string): Promise<string[]> {
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return this.tagsRepository.findTargetIds(targetType, normalized);
  }

  async list(): Promise<TagView[]> {
    const rows = await this.tagsRepository.listWithCounts();
    return rows.map((row) => ({ id: row.id, name: row.name, count: row.count }));
  }
}
