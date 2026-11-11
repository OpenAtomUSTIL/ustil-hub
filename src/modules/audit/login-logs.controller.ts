import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { AdminLogsService } from './admin-logs.service';
import { LoginLogsQueryDto } from './dto/login-logs-query.dto';

@Controller('admin/login-logs')
@Roles(Role.WHEEL, Role.ADMIN)
export class LoginLogsController {
  constructor(private readonly adminLogsService: AdminLogsService) {}

  @Get()
  list(@Query() query: LoginLogsQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.adminLogsService.listLoginLogs(query, user);
  }
}
