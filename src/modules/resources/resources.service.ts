import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Page } from '../../common/dto/page';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { TagTargetType } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { TagsService } from '../tags/tags.service';
import { UsersService } from '../users/users.service';
import { CreateResourceDto, UpdateResourceDto } from './dto/resources.dto';
import { ResourcesQueryDto } from './dto/resources-query.dto';
import { ResourceRow, ResourcesRepository } from './resources.repository';
import { ResourceItem } from './resources.views';

@Injectable()
export class ResourcesService {
  constructor(
    private readonly resourcesRepository: ResourcesRepository,
    private readonly usersService: UsersService,
    private readonly tagsService: TagsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private toItem(row: ResourceRow, creatorName: string, tags: string[]): ResourceItem {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      url: row.url,
      category: row.category,
      tags,
      creatorId: row.creatorId,
      creatorName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async toItems(rows: ResourceRow[]): Promise<ResourceItem[]> {
    const creators = await this.usersService.getPublicByIds(rows.map((row) => row.creatorId));
    const tagsByTarget = await this.tagsService.getNamesByTargets(
      TagTargetType.RESOURCE,
      rows.map((row) => row.id),
    );
    return rows.map((row) => {
      const creator = creators.get(row.creatorId);
      if (!creator) {
        throw new NotFoundException('用户不存在');
      }
      return this.toItem(row, creator.nickname, tagsByTarget.get(row.id) ?? []);
    });
  }

  async list(query: ResourcesQueryDto): Promise<Page<ResourceItem>> {
    const tagTargetIds = query.tag
      ? await this.tagsService.findTargetIds(TagTargetType.RESOURCE, query.tag)
      : undefined;
    const { rows, total } = await this.resourcesRepository.list(query.page, query.pageSize, {
      category: query.category,
      keyword: query.keyword,
      tagTargetIds,
    });
    return {
      items: await this.toItems(rows),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getDetail(id: string): Promise<ResourceItem> {
    const row = await this.resourcesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('资源不存在');
    }
    const [item] = await this.toItems([row]);
    return item;
  }

  async create(user: CurrentAuthUser, dto: CreateResourceDto): Promise<ResourceItem> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const names = this.tagsService.normalizeTags(dto.tags) ?? [];
    const row = await this.resourcesRepository.insert({
      title: dto.title,
      description: dto.description ?? null,
      url: dto.url,
      category: dto.category,
      creatorId: user.id,
    });
    await this.tagsService.syncTags(TagTargetType.RESOURCE, row.id, names);
    await this.auditLogService.record({
      actor: user,
      action: 'resource.create',
      targetType: 'RESOURCE',
      targetId: row.id,
      detail: { title: row.title },
    });
    return this.getDetail(row.id);
  }

  async update(id: string, user: CurrentAuthUser, dto: UpdateResourceDto): Promise<ResourceItem> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.resourcesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('资源不存在');
    }
    if (row.creatorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    const names = this.tagsService.normalizeTags(dto.tags);
    await this.resourcesRepository.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.url !== undefined ? { url: dto.url } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
    });
    if (names !== undefined) {
      await this.tagsService.syncTags(TagTargetType.RESOURCE, id, names);
    }
    await this.auditLogService.record({
      actor: user,
      action: 'resource.update',
      targetType: 'RESOURCE',
      targetId: id,
      detail: { title: dto.title ?? row.title },
    });
    return this.getDetail(id);
  }

  async remove(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.resourcesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('资源不存在');
    }
    if (row.creatorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    await this.resourcesRepository.softDeleteById(id);
    // 软删除保留 taggings，恢复后完整可见
    await this.auditLogService.record({
      actor: user,
      action: 'resource.delete',
      targetType: 'RESOURCE',
      targetId: id,
      detail: { title: row.title, content: (row.description ?? '').slice(0, 200) },
    });
  }

  // ===== 回收站 =====

  async listDeleted(
    page: number,
    pageSize: number,
  ): Promise<{ rows: ResourceRow[]; total: number }> {
    return this.resourcesRepository.listDeleted(page, pageSize);
  }

  async restore(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.resourcesRepository.findByIdIncludingDeleted(id);
    if (!row) {
      throw new NotFoundException('资源不存在');
    }
    if (!row.deletedAt) {
      throw new ConflictException('内容未被删除，无需恢复');
    }
    await this.resourcesRepository.restoreById(id);
    await this.auditLogService.record({
      actor: user,
      action: 'resource.restore',
      targetType: 'RESOURCE',
      targetId: id,
      detail: { title: row.title },
    });
  }
}
