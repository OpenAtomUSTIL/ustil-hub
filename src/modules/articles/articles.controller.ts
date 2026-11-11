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

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  list(@Query() query: ArticlesQueryDto) {
    return this.articlesService.list(query);
  }

  @Get(':id')
  detail(@Param('id', uuidParamPipe) id: string) {
    return this.articlesService.getDetail(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.ALUMNI, Role.WHEEL)
  create(@CurrentUser() user: CurrentAuthUser, @Body() dto: CreateArticleDto) {
    return this.articlesService.create(user, dto);
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
