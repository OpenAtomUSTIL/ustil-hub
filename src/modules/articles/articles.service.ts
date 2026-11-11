import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Page } from '../../common/dto/page';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { UsersService } from '../users/users.service';
import { UserPublic } from '../users/users.views';
import { ArticleRow, ArticlesRepository } from './articles.repository';
import { ArticleDetail, ArticleListItem } from './articles.views';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

const EXCERPT_LENGTH = 120;

@Injectable()
export class ArticlesService {
  constructor(
    private readonly articlesRepository: ArticlesRepository,
    private readonly usersService: UsersService,
  ) {}

  private excerpt(content: string): string {
    return content.length > EXCERPT_LENGTH
      ? `${content.slice(0, EXCERPT_LENGTH)}…`
      : content;
  }

  private toListItem(row: ArticleRow, author: UserPublic): ArticleListItem {
    return {
      id: row.id,
      title: row.title,
      excerpt: this.excerpt(row.content),
      author,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: ArticleRow, author: UserPublic): ArticleDetail {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
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

  async list(query: { page: number; pageSize: number; keyword?: string }): Promise<Page<ArticleListItem>> {
    const { rows, total } = await this.articlesRepository.list(
      query.page,
      query.pageSize,
      query.keyword,
    );
    const authors = await this.usersService.getPublicByIds(rows.map((row) => row.authorId));
    return {
      items: rows.map((row) => {
        const author = authors.get(row.authorId);
        if (!author) {
          throw new NotFoundException('用户不存在');
        }
        return this.toListItem(row, author);
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
    return this.toDetail(row, await this.authorOf(row));
  }

  async create(user: CurrentAuthUser, dto: CreateArticleDto): Promise<ArticleDetail> {
    if (user.role !== Role.ADMIN && user.role !== Role.ALUMNI && user.role !== Role.WHEEL) {
      throw new ForbiddenException('无权访问该资源');
    }
    const row = await this.articlesRepository.insert({
      title: dto.title,
      content: dto.content,
      authorId: user.id,
    });
    return this.toDetail(row, await this.authorOf(row));
  }

  async update(id: string, user: CurrentAuthUser, dto: UpdateArticleDto): Promise<ArticleDetail> {
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    if (row.authorId !== user.id) {
      throw new ForbiddenException('无权访问该资源');
    }
    if (dto.title === undefined && dto.content === undefined) {
      return this.toDetail(row, await this.authorOf(row));
    }
    const updated = await this.articlesRepository.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.content !== undefined ? { content: dto.content } : {}),
    });
    return this.toDetail(updated ?? row, await this.authorOf(updated ?? row));
  }

  async remove(id: string, user: CurrentAuthUser): Promise<void> {
    const row = await this.articlesRepository.findById(id);
    if (!row) {
      throw new NotFoundException('文章不存在');
    }
    if (row.authorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    await this.articlesRepository.deleteById(id);
  }
}
