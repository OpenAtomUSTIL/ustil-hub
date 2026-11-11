import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from '../users/users.module';
import { AdminUsersController } from './admin-users.controller';
import { InviteCodesController } from './invite-codes.controller';
import { InviteCodesRepository } from './invite-codes.repository';
import { InviteCodesService } from './invite-codes.service';
import { SchedulerService } from './scheduler.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [UsersModule, ScheduleModule.forRoot()],
  controllers: [InviteCodesController, AdminUsersController, StatsController],
  providers: [InviteCodesService, InviteCodesRepository, StatsService, SchedulerService],
  exports: [InviteCodesService],
})
export class AdminModule {}
