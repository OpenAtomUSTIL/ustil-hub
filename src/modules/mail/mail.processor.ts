/**
 * 发信队列 worker（BullMQ，v12.0）：同进程消费，按 MAIL_DRIVER 分发到腾讯云 SES API / SMTP。
 * 日志只记模板种类与任务 id，不落收件地址与正文（AGENTS §16.1）。
 */
import { Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';
import { MAIL_QUEUE_NAME, MailJobData } from './mail.types';
import { sendViaSmtp } from './smtp';
import { sendViaTencentSes } from './tencent-ses';

const logger = new Logger('MailProcessor');

async function handleMailJob(cfg: AppConfig, job: Job<MailJobData>): Promise<void> {
  const { to, kind, vars } = job.data;
  if (cfg.mail.driver === 'api') {
    await sendViaTencentSes(
      {
        secretId: cfg.mail.api.secretId,
        secretKey: cfg.mail.api.secretKey,
        region: cfg.mail.api.region,
        from: cfg.mail.from,
        templateIds: cfg.mail.templateIds,
      },
      to,
      kind,
      vars,
    );
  } else if (cfg.mail.driver === 'smtp') {
    await sendViaSmtp({ ...cfg.mail.smtp, from: cfg.mail.from }, to, kind, vars);
  }
  logger.log(`mail sent kind=${kind} job=${job.id}`);
}

/** 创建队列连接与 worker；driver=none 时返回 null（不启动消费） */
export function createMailWorker(cfg: AppConfig): Worker<MailJobData> | null {
  if (cfg.mail.driver === 'none') {
    return null;
  }
  // BullMQ 要求专用连接且 maxRetriesPerRequest: null（阻塞命令）
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  return new Worker<MailJobData>(MAIL_QUEUE_NAME, (job) => handleMailJob(cfg, job), {
    connection,
    concurrency: 4,
  });
}
