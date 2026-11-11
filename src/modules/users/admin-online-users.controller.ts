import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { OnlineUsersQueryDto } from './dto/online-users-query.dto';
import { PresenceService } from './presence.service';

@Controller('admin/online-users')
@Roles(Role.WHEEL, Role.ADMIN)
export class AdminOnlineUsersController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get()
  list(@Query() query: OnlineUsersQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.presenceService.listOnline(query.minutes, user);
  }
}
