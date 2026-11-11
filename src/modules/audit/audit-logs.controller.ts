import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { AdminLogsService } from './admin-logs.service';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';

@Controller('admin/audit-logs')
@Roles(Role.WHEEL, Role.ADMIN)
export class AuditLogsController {
  constructor(private readonly adminLogsService: AdminLogsService) {}

  @Get()
  list(@Query() query: AuditLogsQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.adminLogsService.listAuditLogs(query, user);
  }
}
