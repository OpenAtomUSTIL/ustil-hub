import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import {
  ChangeIssueStatusDto,
  CreateIssueDto,
  CreateReplyDto,
  IssuesQueryDto,
} from './dto/issue.dto';
import { IssuesService } from './issues.service';

@Controller('issues')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Get()
  list(@Query() query: IssuesQueryDto) {
    return this.issuesService.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.issuesService.getDetail(id);
  }

  @Post()
  create(@CurrentUser() user: CurrentAuthUser, @Body() dto: CreateIssueDto) {
    return this.issuesService.create(user, dto);
  }

  @Post(':id/replies')
  reply(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: CreateReplyDto,
  ) {
    return this.issuesService.reply(id, user, dto);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.ALUMNI, Role.WHEEL)
  changeStatus(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: ChangeIssueStatusDto,
  ) {
    return this.issuesService.changeStatus(id, user, dto);
  }

  // 软删除讨论（WHEEL/ADMIN）：进后台回收站可恢复
  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.WHEEL, Role.ADMIN)
  remove(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.issuesService.softDeleteIssue(id, user);
  }
}
