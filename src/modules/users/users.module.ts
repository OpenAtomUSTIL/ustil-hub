import { Global, Module, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { redisProvider, refreshTokenStoreProvider } from '../../db/redis';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { AuditModule } from '../audit/audit.module';
import { CaptchaModule } from '../captcha/captcha.module';
import { MailModule } from '../mail/mail.module';
import { MAIL_RECIPIENT_RESOLVER, MailRecipientResolver } from '../mail/mail.types';
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

// @Global（v12.0）：导出 MAIL_RECIPIENT_RESOLVER 供 notifications 模块注入——
// 使 notifications 无需反向 import Users，避免 Users↔Notifications 模块环（实测双向 forwardRef 会解析僵死）
@Global()
@Module({
  imports: [CryptoModule, StorageModule, NotificationsModule, TagsModule, forwardRef(() => AuditModule), CaptchaModule, MailModule],
  controllers: [UsersController, AdminOnlineUsersController],
  providers: [
    UsersRepository,
    UsersService,
    PresenceService,
    SnakeService,
    redisProvider,
    refreshTokenStoreProvider,
    { provide: APP_INTERCEPTOR, useClass: LastSeenInterceptor },
    // 通知邮件收件人解析（v12.0）：暴露窄接口给 notifications 模块，避免 service 层循环依赖
    {
      provide: MAIL_RECIPIENT_RESOLVER,
      useFactory: (usersService: UsersService): MailRecipientResolver =>
        (userIds: string[]) => usersService.getMailRecipients(userIds),
      inject: [UsersService],
    },
  ],
  exports: [UsersService, SnakeService, MAIL_RECIPIENT_RESOLVER],
})
export class UsersModule {}
