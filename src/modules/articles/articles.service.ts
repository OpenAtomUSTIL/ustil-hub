import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Page } from '../../common/dto/page';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { TagTargetType } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { TagsService } from '../tags/tags.service';
import { UsersService } from '../users/users.service';
import { UserPublic } from '../users/users.views';
import { ArticleRow, ArticlesRepository } from './articles.repository';
import { ArticleDetail, ArticleListItem } from './articles.views';
import { ArticlesQueryDto } from './dto/articles-query.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

const EXCERPT_LENGTH = 120;

@Injectable()
export class ArticlesService {
  constructor(
    private readonly articlesRepository: ArticlesRepository,
    private readonly usersService: UsersService,
    private readonly tagsService: TagsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private excerpt(content: string): string {
    return content.length > EXCERPT_LENGTH
      ? `${content.slice(0, EXCERPT_LENGTH)}…`
      : content;
  }

  private toListItem(row: ArticleRow, author: UserPublic, tags: string[]): ArticleListItem {
    return {
      id: row.id,
      title: row.title,
      excerpt: this.excerpt(row.content),
      tags,
      author,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: ArticleRow, author: UserPublic, tags: string[]): ArticleDetail {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      tags,
      author,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async authorOf(row: ArticleRow): Promise<UserPublic> {
    const map = await this.usersService.getPublicByIds([row.authorId]);
    const author = map.get(row.authorId);
    if (!author) {
      throw new NotFoundException('用户不存在');
    }
    return author;
  }

  async list(query: ArticlesQueryDto): Promise<Page<ArticleListItem>> {
    const tagTargetIds = query.tag
      ? await this.tagsService.findTargetIds(TagTargetType.ARTICLE, query.tag)
      : undefined;
    const { rows, total } = await this.articlesRepository.list(query.page, query.pageSize, {
      keyword: query.keyword,
      authorId: query.authorId,
      tagTargetIds,
    });
    const authors = await this.usersService.getPublicByIds(rows.map((row) => row.authorId));
    const tagsByTarget = await this.tagsService.getNamesByTargets(
      TagTargetType.ARTICLE,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => {
        const author = authors.get(row.authorId);
        if (!author) {
          throw new NotFoundException('用户不存在');
        }
        return this.toListItem(row, author, tagsByTarget.get(row.id) ?? []);
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getDetail(id: string): Promise<ArticleDetail> {
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    const tags = await this.tagsService.getNamesByTargets(TagTargetType.ARTICLE, [row.id]);
    return this.toDetail(row, await this.authorOf(row), tags.get(row.id) ?? []);
  }

  async create(user: CurrentAuthUser, dto: CreateArticleDto): Promise<ArticleDetail> {
    if (user.role !== Role.ADMIN && user.role !== Role.ALUMNI && user.role !== Role.WHEEL) {
      throw new ForbiddenException('无权访问该资源');
    }
    const names = this.tagsService.normalizeTags(dto.tags) ?? [];
    const row = await this.articlesRepository.insert({
      title: dto.title,
      content: dto.content,
      authorId: user.id,
    });
    await this.tagsService.syncTags(TagTargetType.ARTICLE, row.id, names);
    await this.auditLogService.record({
      actor: user,
      action: 'article.create',
      targetType: 'ARTICLE',
      targetId: row.id,
      detail: { title: row.title },
    });
    return this.getDetail(row.id);
  }

  async update(id: string, user: CurrentAuthUser, dto: UpdateArticleDto): Promise<ArticleDetail> {
    requireRole(user, Role.ALUMNI, Role.WHEEL, Role.ADMIN);
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    if (row.authorId !== user.id) {
      throw new ForbiddenException('无权访问该资源');
    }
    const names = this.tagsService.normalizeTags(dto.tags);
    if (dto.title !== undefined || dto.content !== undefined) {
      await this.articlesRepository.update(id, {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
      });
    }
    if (names !== undefined) {
      await this.tagsService.syncTags(TagTargetType.ARTICLE, id, names);
    }
    await this.auditLogService.record({
      actor: user,
      action: 'article.update',
      targetType: 'ARTICLE',
      targetId: id,
      detail: { title: dto.title ?? row.title },
    });
    return this.getDetail(id);
  }

  async remove(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.ALUMNI, Role.WHEEL, Role.ADMIN);
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    if (row.authorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    await this.articlesRepository.softDeleteById(id);
    // 软删除保留 taggings，恢复后完整可见
    await this.auditLogService.record({
      actor: user,
      action: 'article.delete',
      targetType: 'ARTICLE',
      targetId: id,
      detail: { title: row.title, content: row.content.slice(0, 200) },
    });
  }

  // ===== 回收站 =====

  async listDeleted(
    page: number,
    pageSize: number,
  ): Promise<{ rows: ArticleRow[]; total: number }> {
    return this.articlesRepository.listDeleted(page, pageSize);
  }

  async restore(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.articlesRepository.findByIdIncludingDeleted(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    if (!row.deletedAt) {
      throw new ConflictException('内容未被删除，无需恢复');
    }
    await this.articlesRepository.restoreById(id);
    await this.auditLogService.record({
      actor: user,
      action: 'article.restore',
      targetType: 'ARTICLE',
      targetId: id,
      detail: { title: row.title },
    });
  }
}
