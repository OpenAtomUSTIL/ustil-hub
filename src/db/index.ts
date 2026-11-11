import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// 本模块在 import 时创建连接池，早于 ConfigModule.forRoot() 加载 .env；
// 若进程环境缺少 DATABASE_URL 且本地存在 .env，需在此先行加载（不覆盖已有环境变量）。
if (!process.env.DATABASE_URL) {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ustil',
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
