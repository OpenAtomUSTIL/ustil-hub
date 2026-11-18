import { registerAs } from '@nestjs/config';

export const DEFAULT_UPLOAD_MAX_SIZE = 10 * 1024 * 1024;

export const configuration = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? '0'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  storage: {
    driver: process.env.STORAGE_DRIVER === 'r2' ? ('r2' as const) : ('local' as const),
    localDir: process.env.STORAGE_LOCAL_DIR ?? './storage',
    r2: {
      endpoint: process.env.R2_ENDPOINT ?? '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      bucket: process.env.R2_BUCKET ?? '',
      publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? '',
    },
  },
  uploadMaxSize: parseInt(process.env.UPLOAD_MAX_SIZE ?? String(DEFAULT_UPLOAD_MAX_SIZE), 10),
  // 事务邮件（v12.0）：腾讯云邮件推送（SES），MAIL_DRIVER=api|smtp|none
  mail: {
    driver: (process.env.MAIL_DRIVER === 'api' || process.env.MAIL_DRIVER === 'smtp'
      ? process.env.MAIL_DRIVER
      : 'none') as 'api' | 'smtp' | 'none',
    from: process.env.MAIL_FROM ?? '',
    // 邮件链接固定域名（腾讯模板审核规范：变量只承载路径段）
    linkBase: process.env.MAIL_LINK_BASE ?? 'https://forum.openatomustil.cn',
    // 腾讯云 SES 控制台模板 ID（已过审）
    templateIds: {
      'verify-code': Number(process.env.MAIL_TPL_VERIFY_ID ?? 0),
      'reset-password': Number(process.env.MAIL_TPL_RESET_ID ?? 0),
      'notice-reply': Number(process.env.MAIL_TPL_NOTICE_REPLY_ID ?? 0),
      'notice-generic': Number(process.env.MAIL_TPL_NOTICE_ID ?? 0),
    },
    api: {
      secretId: process.env.MAIL_API_SECRET_ID ?? '',
      secretKey: process.env.MAIL_API_SECRET_KEY ?? '',
      region: process.env.MAIL_API_REGION ?? 'ap-guangzhou',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 465),
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  },
}));

export type AppConfig = ReturnType<typeof configuration>;
