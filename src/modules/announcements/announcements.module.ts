import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsRepository } from './announcements.repository';
import { AnnouncementsService } from './announcements.service';

@Module({
  imports: [UsersModule, NotificationsModule, AuditModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsRepository, AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
