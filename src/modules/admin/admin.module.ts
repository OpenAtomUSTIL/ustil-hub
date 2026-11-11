import { Module } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { ArticlesModule } from '../articles/articles.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { AuditModule } from '../audit/audit.module';
import { IssuesModule } from '../issues/issues.module';
import { ResourcesModule } from '../resources/resources.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { AdminApiRegistryController } from './admin-api-registry.controller';
import { AdminFilesController } from './admin-files.controller';
import { AdminFilesService } from './admin-files.service';
import { AdminUsersController } from './admin-users.controller';
import { ApiRegistryService } from './api-registry.service';
import { InviteCodesController } from './invite-codes.controller';
import { InviteCodesRepository } from './invite-codes.repository';
import { InviteCodesService } from './invite-codes.service';
import { SchedulerService } from './scheduler.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    ScheduleModule.forRoot(),
    StorageModule,
    AssignmentsModule,
    ArticlesModule,
    AnnouncementsModule,
    ResourcesModule,
    IssuesModule,
  ],
  controllers: [
    InviteCodesController,
    AdminUsersController,
    StatsController,
    AdminFilesController,
    TrashController,
    AdminApiRegistryController,
  ],
  providers: [
    InviteCodesService,
    InviteCodesRepository,
    StatsService,
    SchedulerService,
    AdminFilesService,
    TrashService,
    ApiRegistryService,
    DiscoveryService,
  ],
  exports: [InviteCodesService],
})
export class AdminModule {}
