import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Controller, Get } from '@nestjs/common';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { StatsService } from './stats.service';

@Controller('admin/stats')
@Roles(Role.WHEEL, Role.ADMIN)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  getStats(@CurrentUser() user: CurrentAuthUser) {
    return this.statsService.getStats(user);
  }
}
