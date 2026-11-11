import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsRepository } from './assignments.repository';
import { AssignmentsService } from './assignments.service';

@Module({
  imports: [UsersModule, StorageModule, NotificationsModule, AuditModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsRepository, AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
