import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { AdminLogsService } from './admin-logs.service';
import { RequestLogsQueryDto } from './dto/request-logs-query.dto';

@Controller('admin/request-logs')
@Roles(Role.WHEEL, Role.ADMIN)
export class RequestLogsController {
  constructor(private readonly adminLogsService: AdminLogsService) {}

  @Get()
  list(@Query() query: RequestLogsQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.adminLogsService.listRequestLogs(query, user);
  }
}
