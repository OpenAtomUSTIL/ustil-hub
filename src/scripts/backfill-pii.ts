/* 个人信息信封加密回填脚本（v10.0，幂等）
   用法：pnpm backfill:pii（先 pnpm build）
   行为：为存量用户生成 crypto_id，把 email/phone/bio/company/location/link/
        socials/profileReadme 明文就地加密为信封 token（认证通过的信封保持不变），
        并写 email_hmac/phone_hmac 精确查找列。
   红线：明文只在内存转换，不打日志；主密钥来自 APP_ENCRYPTION_KEY。 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { eq } from 'drizzle-orm';
import { db, type Database } from '../db';
import { users } from '../db/schema';
import { CryptoService } from '../common/crypto/crypto.service';

// 仅完整信封形态才作为密文候选；普通 v1. 文本仍按明文处理。
const ENVELOPE_PATTERN = /^v1\.[a-f0-9]{32}\.[0-9]+\.[A-Za-z0-9_-]+$/;

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
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // 无 .env 时依赖真实环境变量
  }
}

export async function backfillPii(database: Database, crypto: CryptoService): Promise<void> {
  // 扫描时只取 ID；每行的数据必须在获得行锁之后重新读取。
  const ids = await database.select({ id: users.id }).from(users);
  let updated = 0;
  let skipped = 0;

  for (const { id } of ids) {
    const changed = await database.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!row) return false; // 扫描后用户可能已被删除
      const patch: Partial<typeof users.$inferInsert> = {};
      const cryptoId = row.cryptoId ?? crypto.newCryptoId();
      if (!row.cryptoId) patch.cryptoId = cryptoId;

      const plaintext = (value: string, purpose: string): string => {
        if (!ENVELOPE_PATTERN.test(value)) return value;
        const opened = crypto.open(purpose, value, cryptoId);
        if (opened === null) {
          // 不输出字段值；错误密钥、损坏或跨用户密文均不能再次加密覆盖。
          throw new Error(`用户 ${id} 的 ${purpose} 信封认证失败，已回滚该行`);
        }
        return opened;
      };
      const sealField = (value: string | null, purpose: string): string | null => {
        if (!value) return null;
        const opened = plaintext(value, purpose);
        return ENVELOPE_PATTERN.test(value) ? value : crypto.seal(purpose, opened, cryptoId);
      };
      for (const column of ['email', 'phone', 'bio', 'company', 'location', 'link', 'profileReadme'] as const) {
        const purpose = column === 'email' || column === 'phone' ? column : 'profile';
        const sealed = sealField(row[column], purpose);
        if (sealed !== row[column]) patch[column] = sealed;
      }
      if (row.socials?.length) {
        const sealed = row.socials.map((item) => sealField(item, 'social') ?? '');
        if (sealed.some((item, index) => item !== row.socials![index])) patch.socials = sealed;
      }
      if (row.email && !row.emailHmac) patch.emailHmac = crypto.hmac(plaintext(row.email, 'email').toLowerCase());
      if (row.phone && !row.phoneHmac) patch.phoneHmac = crypto.hmac(plaintext(row.phone, 'phone'));
      if (!Object.keys(patch).length) return false;
      await tx.update(users).set(patch).where(eq(users.id, id));
      return true;
    });
    if (changed) updated += 1;
    else skipped += 1;
  }
  console.log(`[backfill-pii] 完成：加密 ${updated} 行，跳过 ${skipped} 行`);
}

if (require.main === module) {
  loadLocalEnv();
  backfillPii(db, new CryptoService(process.env.APP_ENCRYPTION_KEY ?? '')).catch(() => {
    // 数据库错误可能携带查询参数，不记录原始异常以避免泄露个人资料。
    console.error('[backfill-pii] 回填失败，当前行已回滚；请检查密钥、数据及数据库状态');
    process.exit(1);
  });
}
