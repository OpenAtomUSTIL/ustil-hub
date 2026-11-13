import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
}
