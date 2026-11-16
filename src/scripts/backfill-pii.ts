/* 个人信息信封加密回填脚本（v10.0，幂等）
   用法：pnpm backfill:pii（先 pnpm build）
   行为：为存量用户生成 crypto_id，把 email/phone/bio/company/location/link/
        socials/profileReadme 明文就地加密为信封 token（v1. 前缀识别已加密，跳过），
        并写 email_hmac/phone_hmac 精确查找列。
   红线：明文只在内存转换，不打日志；主密钥来自 APP_ENCRYPTION_KEY。 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { CryptoService } from '../common/crypto/crypto.service';

const TOKEN_PREFIX = 'v1.';

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

function isToken(value: string | null): boolean {
  return !!value && value.startsWith(TOKEN_PREFIX);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const crypto = new CryptoService(process.env.APP_ENCRYPTION_KEY ?? '');
  const rows = await db.select().from(users);
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const patch: Record<string, unknown> = {};
    const cryptoId = row.cryptoId ?? crypto.newCryptoId();
    if (cryptoId !== row.cryptoId) patch.cryptoId = cryptoId;

    const sealField = (column: string, value: string | null, purpose: string): void => {
      if (isToken(value) || !value) return;
      patch[column] = crypto.seal(purpose, value, cryptoId);
    };
    sealField('email', row.email, 'email');
    sealField('phone', row.phone, 'phone');
    sealField('bio', row.bio, 'profile');
    sealField('company', row.company, 'profile');
    sealField('location', row.location, 'profile');
    sealField('link', row.link, 'profile');
    sealField('profileReadme', row.profileReadme, 'profile');

    if (row.socials && row.socials.length > 0 && !row.socials.some((item) => isToken(item))) {
      patch.socials = row.socials.map((item) => crypto.seal('social', item, cryptoId));
    }

    // 查找列：仅当仍是明文时可计算 HMAC（已加密而缺 hmac 的行无法补算，需人工核对）
    if (row.email && !isToken(row.email)) patch.emailHmac = crypto.hmac(row.email.toLowerCase());
    else if (isToken(row.email) && !row.emailHmac) console.warn(`跳过：用户 ${row.id} email 已加密但缺 email_hmac，无法补算`);
    if (row.phone && !isToken(row.phone)) patch.phoneHmac = crypto.hmac(row.phone);
    else if (isToken(row.phone) && !row.phoneHmac) console.warn(`跳过：用户 ${row.id} phone 已加密但缺 phone_hmac，无法补算`);

    if (Object.keys(patch).length === 0) {
      skipped += 1;
      continue;
    }
    await db.update(users).set(patch).where(eq(users.id, row.id));
    updated += 1;
  }
  console.log(`[backfill-pii] 完成：加密 ${updated} 行，跳过 ${skipped} 行`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
