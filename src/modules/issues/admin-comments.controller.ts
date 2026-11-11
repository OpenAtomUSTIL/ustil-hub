import { Controller, Delete, Get, HttpCode, Param, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { CommentsQueryDto } from './dto/issue.dto';
import { IssuesService } from './issues.service';

@Controller('admin/comments')
@Roles(Role.WHEEL, Role.ADMIN)
export class AdminCommentsController {
  constructor(private readonly issuesService: IssuesService) {}

  @Get()
  list(@Query() query: CommentsQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.issuesService.listRepliesForAdmin(query, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.issuesService.softDeleteReply(id, user);
  }
}
