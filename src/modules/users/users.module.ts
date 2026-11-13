import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { redisProvider, refreshTokenStoreProvider } from '../../db/redis';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { TagsModule } from '../tags/tags.module';
import { AdminOnlineUsersController } from './admin-online-users.controller';
import { LastSeenInterceptor } from './last-seen.interceptor';
import { PresenceService } from './presence.service';
import { SnakeService } from './snake.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [StorageModule, NotificationsModule, AuditModule, TagsModule],
  controllers: [UsersController, AdminOnlineUsersController],
  providers: [
    UsersRepository,
    UsersService,
    PresenceService,
    SnakeService,
    redisProvider,
    refreshTokenStoreProvider,
    { provide: APP_INTERCEPTOR, useClass: LastSeenInterceptor },
  ],
  exports: [UsersService, SnakeService],
})
export class UsersModule {}
