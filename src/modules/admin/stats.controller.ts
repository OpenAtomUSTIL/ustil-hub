import { Controller, Get } from '@nestjs/common';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { StatsService } from './stats.service';

@Controller('admin/stats')
@Roles(Role.WHEEL, Role.ADMIN)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  getStats() {
    return this.statsService.getStats();
  }
}
