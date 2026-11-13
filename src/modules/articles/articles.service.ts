import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Page } from '../../common/dto/page';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { TagTargetType } from '../../db/schema';
import { uniqueSlug } from '../../common/utils/identifiers';
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
const EXCERPT_HARD_LENGTH = 600;

@Injectable()
export class ArticlesService {
  constructor(
    private readonly articlesRepository: ArticlesRepository,
    private readonly usersService: UsersService,
    private readonly tagsService: TagsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** 列表卡片渲染预览：按块截取；HTML/代码块保整避免截断半个标签；残缺尾标签剔除 */
  private excerpt(content: string): string {
    const full = content.trim();
    const blocks = full.split(/\n{2,}/);
    const picked: string[] = [];
    let textLength = 0;
    let truncated = false;
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('<') || trimmed.startsWith('```')) {
        picked.push(trimmed);
        continue;
      }
      const room = EXCERPT_LENGTH - textLength;
      if (room <= 0) {
        truncated = true;
        break;
      }
      if (trimmed.length > room) {
        picked.push(trimmed.slice(0, room));
        truncated = true;
        break;
      }
      picked.push(trimmed);
      textLength += trimmed.length;
    }
    let text = picked.join('\n\n');
    if (text.length > EXCERPT_HARD_LENGTH) {
      text = text.slice(0, EXCERPT_HARD_LENGTH);
      truncated = true;
    }
    text = text.replace(/<\/?[a-zA-Z][^>]*$/, '');
    return truncated ? `${text}…` : text;
  }

  private toListItem(row: ArticleRow, author: UserPublic, tags: string[]): ArticleListItem {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: this.excerpt(row.content),
      tags,
      author,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: ArticleRow, author: UserPublic, tags: string[]): ArticleDetail {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      content: row.content,
      tags,
      author,
      status: row.status,
      reviewNote: row.reviewNote,
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

  private isStaff(user: CurrentAuthUser): boolean {
    return user.role === Role.WHEEL || user.role === Role.ADMIN;
  }

  async list(query: ArticlesQueryDto): Promise<Page<ArticleListItem>> {
    const tagTargetIds = query.tag
      ? await this.tagsService.findTargetIds(TagTargetType.ARTICLE, query.tag)
      : undefined;
    // 公开列表只展示 PUBLISHED；作者过滤时展示自己的全部状态
    const statusFilter = query.authorId ? undefined : 'PUBLISHED';
    const { rows, total } = await this.articlesRepository.list(query.page, query.pageSize, {
      keyword: query.keyword,
      authorId: query.authorId,
      tagTargetIds,
      status: statusFilter,
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

  async getDetail(id: string, user?: CurrentAuthUser): Promise<ArticleDetail> {
    const row = await this.articlesRepository.findByIdOrSlug(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    // 非 PUBLISHED 文章仅作者和 WHEEL/ADMIN 可见
    if (row.status !== 'PUBLISHED') {
      const isAuthor = user && row.authorId === user.id;
      const isStaff = user && this.isStaff(user);
      if (!isAuthor && !isStaff) {
        throw new NotFoundException('文章不存在');
      }
    }
    const tags = await this.tagsService.getNamesByTargets(TagTargetType.ARTICLE, [row.id]);
    return this.toDetail(row, await this.authorOf(row), tags.get(row.id) ?? []);
  }

  async create(user: CurrentAuthUser, dto: CreateArticleDto): Promise<ArticleDetail> {
    // MEMBER 先审后发 → PENDING；ALUMNI/WHEEL/ADMIN 先发后审 → PUBLISHED
    const status = user.role === Role.MEMBER ? 'PENDING' : 'PUBLISHED';
    const names = this.tagsService.normalizeTags(dto.tags) ?? [];
    const slug = await uniqueSlug(dto.title, (s) => this.articlesRepository.slugExists(s));
    const row = await this.articlesRepository.insert({
      title: dto.title,
      slug,
      content: dto.content,
      authorId: user.id,
      status,
    });
    await this.tagsService.syncTags(TagTargetType.ARTICLE, row.id, names);
    await this.auditLogService.record({
      actor: user,
      action: 'article.create',
      targetType: 'ARTICLE',
      targetId: row.id,
      detail: { title: row.title, status },
    });
    return this.getDetail(row.id, user);
  }

  async update(id: string, user: CurrentAuthUser, dto: UpdateArticleDto): Promise<ArticleDetail> {
    requireRole(user, Role.MEMBER, Role.ALUMNI, Role.WHEEL, Role.ADMIN);
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    if (row.authorId !== user.id) {
      throw new ForbiddenException('无权访问该资源');
    }
    // MEMBER 只能编辑自己的 PENDING / REJECTED 文章
    if (user.role === Role.MEMBER && row.status !== 'PENDING' && row.status !== 'REJECTED') {
      throw new ForbiddenException('已发布的文章需联系管理员修改');
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
    return this.getDetail(id, user);
  }

  async remove(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.MEMBER, Role.ALUMNI, Role.WHEEL, Role.ADMIN);
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    if (row.authorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    // MEMBER 只能删除自己的 PENDING / REJECTED 文章
    if (user.role === Role.MEMBER && row.status !== 'PENDING' && row.status !== 'REJECTED') {
      throw new ForbiddenException('已发布的文章需联系管理员删除');
    }
    await this.articlesRepository.softDeleteById(id);
    await this.auditLogService.record({
      actor: user,
      action: 'article.delete',
      targetType: 'ARTICLE',
      targetId: id,
      detail: { title: row.title, content: row.content.slice(0, 200) },
    });
  }

  // ===== 审核 =====

  /** 审核队列：PENDING 文章列表 */
  async listPending(page: number, pageSize: number): Promise<Page<ArticleListItem>> {
    const { rows, total } = await this.articlesRepository.list(page, pageSize, {
      status: 'PENDING',
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
      page,
      pageSize,
    };
  }

  /** 审核操作：approve 通过 / reject 拒绝 / hide 隐藏（先发后审）/ unhide 取消隐藏 */
  async review(
    id: string,
    user: CurrentAuthUser,
    action: 'approve' | 'reject' | 'hide' | 'unhide',
    note?: string,
  ): Promise<ArticleDetail> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    const statusMap: Record<string, string> = {
      approve: 'PUBLISHED',
      reject: 'REJECTED',
      hide: 'HIDDEN',
      unhide: 'PUBLISHED',
    };
    const nextStatus = statusMap[action];
    if (!nextStatus) {
      throw new ConflictException('未知审核操作');
    }
    // 状态机校验
    if (action === 'approve' && row.status !== 'PENDING') {
      throw new ConflictException('仅待审文章可通过');
    }
    if (action === 'reject' && row.status !== 'PENDING') {
      throw new ConflictException('仅待审文章可拒绝');
    }
    if (action === 'hide' && row.status !== 'PUBLISHED') {
      throw new ConflictException('仅已发布文章可隐藏');
    }
    if (action === 'unhide' && row.status !== 'HIDDEN') {
      throw new ConflictException('仅已隐藏文章可取消隐藏');
    }
    await this.articlesRepository.updateStatus(id, nextStatus, user.id, note);
    await this.auditLogService.record({
      actor: user,
      action: `article.review.${action}`,
      targetType: 'ARTICLE',
      targetId: id,
      detail: { title: row.title, from: row.status, to: nextStatus, note },
    });
    return this.getDetail(id, user);
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
