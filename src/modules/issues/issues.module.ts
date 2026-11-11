import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TagsModule } from '../tags/tags.module';
import { UsersModule } from '../users/users.module';
import { AdminCommentsController } from './admin-comments.controller';
import { IssuesController } from './issues.controller';
import { IssuesRepository } from './issues.repository';
import { IssuesService } from './issues.service';

@Module({
  imports: [UsersModule, TagsModule, NotificationsModule, AuditModule],
  controllers: [IssuesController, AdminCommentsController],
  providers: [IssuesRepository, IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
