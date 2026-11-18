import { Module } from '@nestjs/common';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

// 依赖 UsersModule 的 MAIL_RECIPIENT_RESOLVER 经 @Global 全局导出注入，此处不 import Users（避免模块环）
@Module({
  imports: [MailModule, CryptoModule],
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
