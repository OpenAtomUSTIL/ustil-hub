/**
 * 事务邮件模块（v12.0）：发信单出口（队列异步）+ 邮件验证码 + 邮件链接令牌。
 * 服务商：腾讯云邮件推送（SES），MAIL_DRIVER=api|smtp|none。
 */
import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { AppConfig, configuration } from '../../config/configuration';
import { REDIS_CLIENT, RedisClient, redisProvider } from '../../db/redis';
import { EmailCodeService } from './email-code.service';
import { ResetTokenStore } from './link-tokens';
import { createMailWorker } from './mail.processor';
import { MAIL_QUEUE, MailService } from './mail.service';
import { MAIL_QUEUE_NAME, MailJobData } from './mail.types';

export const RESET_TOKEN_STORE = 'RESET_TOKEN_STORE';
const MAIL_WORKER = 'MAIL_WORKER';

/** 队列连接（BullMQ 要求专用连接且 maxRetriesPerRequest: null）；driver=none 时不建 */
const mailQueueProvider = {
  provide: MAIL_QUEUE,
  useFactory: (cfg: AppConfig): Queue<MailJobData> | null => {
    if (cfg.mail.driver === 'none') return null;
    const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    return new Queue<MailJobData>(MAIL_QUEUE_NAME, { connection });
  },
  inject: [configuration.KEY],
};

const resetTokenStoreProvider = {
  provide: RESET_TOKEN_STORE,
  useFactory: (redis: RedisClient) => new ResetTokenStore(redis),
  inject: [REDIS_CLIENT],
};

const mailWorkerProvider = {
  provide: MAIL_WORKER,
  useFactory: (cfg: AppConfig) => createMailWorker(cfg),
  inject: [configuration.KEY],
};

@Module({
  imports: [CryptoModule],
  providers: [
    MailService,
    EmailCodeService,
    mailQueueProvider,
    resetTokenStoreProvider,
    mailWorkerProvider,
    redisProvider,
  ],
  exports: [MailService, EmailCodeService, RESET_TOKEN_STORE],
})
export class MailModule implements OnModuleDestroy {
  constructor(@Inject(MAIL_WORKER) private readonly worker: Worker<MailJobData> | null) {}

  onModuleDestroy(): void {
    void this.worker?.close();
  }
}
