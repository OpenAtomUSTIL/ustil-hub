/**
 * 发信单出口（v12.0）：业务只调 send()，实际发送经 BullMQ 异步队列（AGENTS §2 已解禁项）。
 * 通知邮件失败可降级；验证码邮件必须明确返回入队失败，避免误报发送成功。
 */
import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
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

  /** 入队即返回；驱动为 none 时通知直接跳过，验证码明确告知不可发送 */
  async send(to: string, kind: MailKind, vars: MailVars): Promise<void> {
    if (this.cfg.mail.driver === 'none' || !this.queue) {
      if (kind === 'verify-code') throw new ServiceUnavailableException('验证码邮件暂时无法发送，请稍后重试');
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
    } catch {
      // 队列异常可能包含任务内容；日志只记录邮件种类。
      this.logger.warn(`mail enqueue failed: kind=${kind}`);
      if (kind === 'verify-code') throw new ServiceUnavailableException('验证码邮件暂时无法发送，请稍后重试');
    }
  }
}
