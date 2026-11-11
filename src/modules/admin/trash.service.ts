import { Injectable } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { Page } from '../../common/dto/page';
import { requireRole } from '../../common/permissions';
import { AnnouncementRow } from '../announcements/announcements.repository';
import { AnnouncementsService } from '../announcements/announcements.service';
import { ArticleRow } from '../articles/articles.repository';
import { ArticlesService } from '../articles/articles.service';
import { DeletedReplySnapshot } from '../issues/issues.views';
import { IssuesService } from '../issues/issues.service';
import { ResourceRow } from '../resources/resources.repository';
import { ResourcesService } from '../resources/resources.service';
import { TrashQueryDto } from './dto/trash-query.dto';
import { TRASH_TYPES, TrashItem, TrashType } from './trash.views';

const EXCERPT_LENGTH = 120;

@Injectable()
export class TrashService {
  constructor(
    private readonly articlesService: ArticlesService,
    private readonly announcementsService: AnnouncementsService,
    private readonly resourcesService: ResourcesService,
    private readonly issuesService: IssuesService,
  ) {}

  private excerpt(content: string): string {
    return content.length > EXCERPT_LENGTH ? `${content.slice(0, EXCERPT_LENGTH)}…` : content;
  }

  private articleItem(row: ArticleRow): TrashItem {
    return {
      id: row.id,
      type: 'ARTICLE',
      title: row.title,
      summary: this.excerpt(row.content),
      deletedAt: (row.deletedAt as Date).toISOString(),
      original: {
        title: row.title,
        content: row.content,
        authorId: row.authorId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  private announcementItem(row: AnnouncementRow): TrashItem {
    return {
      id: row.id,
      type: 'ANNOUNCEMENT',
      title: row.title,
      summary: this.excerpt(row.content),
      deletedAt: (row.deletedAt as Date).toISOString(),
      original: {
        title: row.title,
        content: row.content,
        pinned: row.pinned,
        authorId: row.authorId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  private resourceItem(row: ResourceRow): TrashItem {
    return {
      id: row.id,
      type: 'RESOURCE',
      title: row.title,
      summary: this.excerpt(row.description ?? ''),
      deletedAt: (row.deletedAt as Date).toISOString(),
      original: {
        title: row.title,
        description: row.description,
        url: row.url,
        category: row.category,
        creatorId: row.creatorId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  private commentItem(row: DeletedReplySnapshot): TrashItem {
    return {
      id: row.id,
      type: 'COMMENT',
      title: row.issueTitle,
      summary: this.excerpt(row.content),
      deletedAt: row.deletedAt,
      original: {
        issueId: row.issueId,
        issueTitle: row.issueTitle,
        authorId: row.authorId,
        content: row.content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  }

  private async listSingleType(
    type: TrashType,
    page: number,
    pageSize: number,
  ): Promise<{ items: TrashItem[]; total: number }> {
    switch (type) {
      case 'ARTICLE': {
        const { rows, total } = await this.articlesService.listDeleted(page, pageSize);
        return { items: rows.map((row) => this.articleItem(row)), total };
      }
      case 'ANNOUNCEMENT': {
        const { rows, total } = await this.announcementsService.listDeleted(page, pageSize);
        return { items: rows.map((row) => this.announcementItem(row)), total };
      }
      case 'RESOURCE': {
        const { rows, total } = await this.resourcesService.listDeleted(page, pageSize);
        return { items: rows.map((row) => this.resourceItem(row)), total };
      }
      case 'COMMENT': {
        const { rows, total } = await this.issuesService.listDeletedReplies(page, pageSize);
        return { items: rows.map((row) => this.commentItem(row)), total };
      }
    }
  }

  async list(query: TrashQueryDto, actor: CurrentAuthUser): Promise<Page<TrashItem>> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    if (query.type) {
      const { items, total } = await this.listSingleType(query.type, query.page, query.pageSize);
      return { items, total, page: query.page, pageSize: query.pageSize };
    }
    // 不带 type：四类合并按 deletedAt desc 分页（各源取窗口后归并）
    const offset = (query.page - 1) * query.pageSize;
    const windowSize = offset + query.pageSize;
    const perType = await Promise.all(
      TRASH_TYPES.map((type) => this.listSingleType(type, 1, windowSize)),
    );
    const items = perType
      .flatMap((result) => result.items)
      .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0))
      .slice(offset, offset + query.pageSize);
    const total = perType.reduce((sum, result) => sum + result.total, 0);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async restore(type: TrashType, id: string, actor: CurrentAuthUser): Promise<void> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    switch (type) {
      case 'ARTICLE':
        return this.articlesService.restore(id, actor);
      case 'ANNOUNCEMENT':
        return this.announcementsService.restore(id, actor);
      case 'RESOURCE':
        return this.resourcesService.restore(id, actor);
      case 'COMMENT':
        return this.issuesService.restoreReply(id, actor);
    }
  }
}
