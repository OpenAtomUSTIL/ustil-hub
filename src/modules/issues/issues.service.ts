import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { Page } from '../../common/dto/page';
import { IssueStatus } from '../../db/schema';
import { UsersService } from '../users/users.service';
import { UserPublic } from '../users/users.views';
import {
  ChangeIssueStatusDto,
  CreateIssueDto,
  CreateReplyDto,
  IssuesQueryDto,
} from './dto/issue.dto';
import { IssueRow, IssuesRepository, ReplyRow } from './issues.repository';
import { IssueDetail, IssueListItem, ReplyView } from './issues.views';

@Injectable()
export class IssuesService {
  constructor(
    private readonly issuesRepository: IssuesRepository,
    private readonly usersService: UsersService,
  ) {}

  private async usersByIds(ids: string[]): Promise<Map<string, UserPublic>> {
    return this.usersService.getPublicByIds(ids.filter((id) => id.length > 0));
  }

  private toListItem(
    row: IssueRow,
    author: UserPublic,
    answeredBy: UserPublic | null,
    replyCount: number,
  ): IssueListItem {
    return {
      id: row.id,
      title: row.title,
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
    return {
      ...this.toListItem(row, author, answeredBy, replies.length),
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
    const { rows, total } = await this.issuesRepository.list(
      query.page,
      query.pageSize,
      query.status,
      query.keyword,
    );
    const replyCounts = await this.issuesRepository.countReplies(rows.map((row) => row.id));
    const users = await this.usersByIds([
      ...rows.map((row) => row.authorId),
      ...rows.map((row) => row.answeredBy ?? ''),
    ]);
    return {
      items: rows.map((row) => {
        const author = users.get(row.authorId);
        if (!author) {
          throw new NotFoundException('用户不存在');
        }
        const answeredBy = row.answeredBy ? (users.get(row.answeredBy) ?? null) : null;
        return this.toListItem(row, author, answeredBy, replyCounts.get(row.id) ?? 0);
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
    const row = await this.issuesRepository.insert({
      title: dto.title,
      content: dto.content,
      authorId: user.id,
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
    return this.getDetail(id);
  }
}
