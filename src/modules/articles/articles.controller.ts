import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

import { Roles, Role } from '../../common/decorators/roles.decorator';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ArticlesService } from './articles.service';
import { ArticlesQueryDto } from './dto/articles-query.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ReviewArticleDto } from './dto/review-article.dto';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  list(@Query() query: ArticlesQueryDto) {
    return this.articlesService.list(query);
  }

  @Get('pending')
  @Roles(Role.WHEEL, Role.ADMIN)
  listPending(@Query('page') page: string, @Query('pageSize') pageSize: string) {
    return this.articlesService.listPending(
      Number(page) || 1,
      Number(pageSize) || 20,
    );
  }

  @Get(':id')
  detail(@Param('id', uuidParamPipe) id: string, @CurrentUser() user?: CurrentAuthUser) {
    return this.articlesService.getDetail(id, user);
  }

  @Post()
  @Roles(Role.MEMBER, Role.ALUMNI, Role.WHEEL, Role.ADMIN)
  create(@CurrentUser() user: CurrentAuthUser, @Body() dto: CreateArticleDto) {
    return this.articlesService.create(user, dto);
  }

  @Post(':id/review')
  @Roles(Role.WHEEL, Role.ADMIN)
  review(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: ReviewArticleDto,
  ) {
    return this.articlesService.review(id, user, dto.action, dto.note);
  }

  @Patch(':id')
  update(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articlesService.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.articlesService.remove(id, user);
  }
}
