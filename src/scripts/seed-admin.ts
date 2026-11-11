/* 初始 ADMIN 账号种子脚本（幂等）
   用法：pnpm seed:admin（先 pnpm build）
   行为：ADMIN_EMAIL / ADMIN_PASSWORD 均必填；该邮箱已存在则跳过，
        否则以 Argon2id（AGENTS.md §11.1）创建 role=ADMIN 账号。
   红线：明文密码只来自环境变量，绝不入库、不打日志。 */
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { db } from '../db';
import { users } from '../db/schema';
import { hashPassword } from '../modules/auth/password';

function loadLocalEnv(): void {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // 无 .env 时仅使用进程环境变量
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';

  if (!email.includes('@')) {
    console.error('[seed-admin] 失败：ADMIN_EMAIL 缺失或不是邮箱');
    process.exit(1);
  }
  if (password.length < 8 || password.length > 128) {
    console.error('[seed-admin] 失败：ADMIN_PASSWORD 缺失或长度不在 8-128 之间');
    process.exit(1);
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    console.log(`[seed-admin] 用户已存在，跳过：${email}`);
    return;
  }

  // ADMIN 全局唯一：已存在 ADMIN 但邮箱不同 → 报错退出
  const existingAdmin = await db.query.users.findFirst({ where: eq(users.role, 'ADMIN') });
  if (existingAdmin) {
    console.error(
      `[seed-admin] 失败：已存在 ADMIN 账号（${existingAdmin.email ?? existingAdmin.id}），与 ADMIN_EMAIL 不一致`,
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      nickname: '管理员',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    .returning({ id: users.id });

  console.log(`[seed-admin] 已创建 ADMIN：${email}（id=${row.id}）`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[seed-admin] 失败：', error instanceof Error ? error.message : error);
    process.exit(1);
  });
