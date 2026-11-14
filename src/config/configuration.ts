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
}));

export type AppConfig = ReturnType<typeof configuration>;
