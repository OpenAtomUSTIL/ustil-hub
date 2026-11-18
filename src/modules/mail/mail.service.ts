/**
 * 发信单出口（v12.0）：业务只调 send()，实际发送经 BullMQ 异步队列（AGENTS §2 已解禁项）。
 * 发信失败不打断主流程（静默降级 + 告警日志，日志不落收件地址与正文）。
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfig, configuration } from '../../config/configuration';
import { MailJobData, MailKind, MailVars } from './mail.types';

export const MAIL_QUEUE = 'MAIL_QUEUE';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(configuration.KEY) private readonly cfg: AppConfig,
    @Optional() @Inject(MAIL_QUEUE) private readonly queue: Queue<MailJobData> | null,
  ) {}

  get driver(): string {
    return this.cfg.mail.driver;
  }

  /** 入队即返回；驱动为 none 时直接跳过（开发/测试环境不配发信也能跑） */
  async send(to: string, kind: MailKind, vars: MailVars): Promise<void> {
    if (this.cfg.mail.driver === 'none' || !this.queue) {
      this.logger.debug(`mail skipped (driver=none) kind=${kind}`);
      return;
    }
    try {
      await this.queue.add(
        'send',
        { to, kind, vars },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 200,
          removeOnFail: 1000,
        },
      );
    } catch (error) {
      this.logger.warn(
        `mail enqueue failed: kind=${kind} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
