import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { Page } from '../../common/dto/page';
import { requireRole } from '../../common/permissions';
import { IssueStatus, TagTargetType } from '../../db/schema';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TagsService } from '../tags/tags.service';
import { UsersService } from '../users/users.service';
import { UserPublic } from '../users/users.views';
import {
  ChangeIssueStatusDto,
  CommentsQueryDto,
  CreateIssueDto,
  CreateReplyDto,
  IssuesQueryDto,
} from './dto/issue.dto';
import { IssueRow, IssuesRepository, ReplyRow, ReplyWithIssueRow } from './issues.repository';
import {
  CommentItem,
  DeletedReplySnapshot,
  IssueDetail,
  IssueListItem,
  ReplyView,
} from './issues.views';

@Injectable()
export class IssuesService {
  constructor(
    private readonly issuesRepository: IssuesRepository,
    private readonly usersService: UsersService,
    private readonly tagsService: TagsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async usersByIds(ids: string[]): Promise<Map<string, UserPublic>> {
    return this.usersService.getPublicByIds(ids.filter((id) => id.length > 0));
  }

  private toListItem(
    row: IssueRow,
    author: UserPublic,
    answeredBy: UserPublic | null,
    replyCount: number,
    tags: string[],
  ): IssueListItem {
    return {
      id: row.id,
      title: row.title,
      tags,
      status: row.status,
      author,
      replyCount,
      answeredBy,
      answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toReplyView(row: ReplyRow, author: UserPublic): ReplyView {
    return {
      id: row.id,
      content: row.content,
      author,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async detailOf(row: IssueRow, replies: ReplyRow[]): Promise<IssueDetail> {
    const ids = [row.authorId, row.answeredBy ?? '', ...replies.map((r) => r.authorId)];
    const users = await this.usersByIds(ids);
    const author = users.get(row.authorId);
    if (!author) {
      throw new NotFoundException('用户不存在');
    }
    const answeredBy = row.answeredBy ? (users.get(row.answeredBy) ?? null) : null;
    const tags = await this.tagsService.getNamesByTargets(TagTargetType.ISSUE, [row.id]);
    return {
      ...this.toListItem(row, author, answeredBy, replies.length, tags.get(row.id) ?? []),
      content: row.content,
      replies: replies.map((reply) => {
        const replyAuthor = users.get(reply.authorId);
        if (!replyAuthor) {
          throw new NotFoundException('用户不存在');
        }
        return this.toReplyView(reply, replyAuthor);
      }),
    };
  }

  async list(query: IssuesQueryDto): Promise<Page<IssueListItem>> {
    const tagTargetIds = query.tag
      ? await this.tagsService.findTargetIds(TagTargetType.ISSUE, query.tag)
      : undefined;
    const { rows, total } = await this.issuesRepository.list(query.page, query.pageSize, {
      status: query.status,
      keyword: query.keyword,
      tagTargetIds,
    });
    const replyCounts = await this.issuesRepository.countReplies(rows.map((row) => row.id));
    const users = await this.usersByIds([
      ...rows.map((row) => row.authorId),
      ...rows.map((row) => row.answeredBy ?? ''),
    ]);
    const tagsByTarget = await this.tagsService.getNamesByTargets(
      TagTargetType.ISSUE,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => {
        const author = users.get(row.authorId);
        if (!author) {
          throw new NotFoundException('用户不存在');
        }
        const answeredBy = row.answeredBy ? (users.get(row.answeredBy) ?? null) : null;
        return this.toListItem(
          row,
          author,
          answeredBy,
          replyCounts.get(row.id) ?? 0,
          tagsByTarget.get(row.id) ?? [],
        );
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getDetail(id: string): Promise<IssueDetail> {
    const row = await this.issuesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('问题不存在');
    }
    const replies = await this.issuesRepository.findReplies(id);
    return this.detailOf(row, replies);
  }

  async create(user: CurrentAuthUser, dto: CreateIssueDto): Promise<IssueDetail> {
    if (user.role === Role.VISITOR) {
      throw new ForbiddenException('无权访问该资源');
    }
    const names = this.tagsService.normalizeTags(dto.tags) ?? [];
    const row = await this.issuesRepository.insert({
      title: dto.title,
      content: dto.content,
      authorId: user.id,
    });
    await this.tagsService.syncTags(TagTargetType.ISSUE, row.id, names);
    await this.auditLogService.record({
      actor: user,
      action: 'issue.create',
      targetType: 'ISSUE',
      targetId: row.id,
      detail: { title: row.title },
    });
    return this.detailOf(row, []);
  }

  async reply(id: string, user: CurrentAuthUser, dto: CreateReplyDto): Promise<ReplyView> {
    const row = await this.issuesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('问题不存在');
    }
    const replyRow = await this.issuesRepository.insertReply({
      issueId: id,
      authorId: user.id,
      content: dto.content,
    });
    // 通知楼主（自己回复自己不通知）
    if (row.authorId !== user.id) {
      await this.notificationsService.notifyUser(row.authorId, {
        type: 'ISSUE_REPLY',
        title: row.title,
        link: `/issues/${row.id}`,
      });
    }
    const users = await this.usersByIds([user.id]);
    const author = users.get(user.id);
    if (!author) {
      throw new NotFoundException('用户不存在');
    }
    return this.toReplyView(replyRow, author);
  }

  async changeStatus(
    id: string,
    user: CurrentAuthUser,
    dto: ChangeIssueStatusDto,
  ): Promise<IssueDetail> {
    if (user.role !== Role.ADMIN && user.role !== Role.ALUMNI && user.role !== Role.WHEEL) {
      throw new ForbiddenException('无权访问该资源');
    }
    const row = await this.issuesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('问题不存在');
    }
    // →ANSWERED 记录 answeredBy/answeredAt；离开 ANSWERED 时清空
    const isAnswered = dto.status === IssueStatus.ANSWERED;
    await this.issuesRepository.updateStatus(id, {
      status: dto.status,
      answeredBy: isAnswered ? user.id : null,
      answeredAt: isAnswered ? new Date() : null,
    });
    await this.auditLogService.record({
      actor: user,
      action: 'issue.update',
      targetType: 'ISSUE',
      targetId: id,
      detail: { from: row.status, to: dto.status },
    });
    return this.getDetail(id);
  }

  // ===== 管理端评论（讨论回复） =====

  private toCommentItem(row: ReplyWithIssueRow, authorName: string): CommentItem {
    return {
      id: row.id,
      issueId: row.issueId,
      issueTitle: row.issueTitle,
      authorId: row.authorId,
      authorName,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }

  async listRepliesForAdmin(
    query: CommentsQueryDto,
    actor: CurrentAuthUser,
  ): Promise<Page<CommentItem>> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const trimmed = query.keyword?.trim();
    const authorIds = trimmed ? await this.usersService.searchIdsByKeyword(trimmed) : undefined;
    const { rows, total } = await this.issuesRepository.listRepliesForAdmin({
      keyword: trimmed,
      authorIds,
      page: query.page,
      pageSize: query.pageSize,
    });
    const authors = await this.usersByIds(rows.map((row) => row.authorId));
    return {
      items: rows.map((row) => {
        const author = authors.get(row.authorId);
        return this.toCommentItem(row, author ? author.nickname : '已注销用户');
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async softDeleteReply(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.issuesRepository.findReplyById(id);
    if (!row || row.deletedAt) {
      throw new NotFoundException('评论不存在');
    }
    await this.issuesRepository.softDeleteReply(id);
    await this.auditLogService.record({
      actor: user,
      action: 'comment.delete',
      targetType: 'COMMENT',
      targetId: id,
      detail: { issueId: row.issueId, content: row.content.slice(0, 200) },
    });
  }

  // ===== 回收站 =====

  private toDeletedSnapshot(row: ReplyWithIssueRow): DeletedReplySnapshot {
    return {
      id: row.id,
      issueId: row.issueId,
      issueTitle: row.issueTitle,
      authorId: row.authorId,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: (row.deletedAt as Date).toISOString(),
    };
  }

  async listDeletedReplies(
    page: number,
    pageSize: number,
  ): Promise<{ rows: DeletedReplySnapshot[]; total: number }> {
    const { rows, total } = await this.issuesRepository.listDeletedReplies(page, pageSize);
    return { rows: rows.map((row) => this.toDeletedSnapshot(row)), total };
  }

  async restoreReply(id: string, user: CurrentAuthUser): Promise<void> {
    requireRole(user, Role.WHEEL, Role.ADMIN);
    const row = await this.issuesRepository.findReplyById(id);
    if (!row) {
      throw new NotFoundException('评论不存在');
    }
    if (!row.deletedAt) {
      throw new ConflictException('内容未被删除，无需恢复');
    }
    await this.issuesRepository.restoreReply(id);
    await this.auditLogService.record({
      actor: user,
      action: 'comment.restore',
      targetType: 'COMMENT',
      targetId: id,
      detail: { issueId: row.issueId, content: row.content.slice(0, 200) },
    });
  }
}
