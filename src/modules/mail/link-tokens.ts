/**
 * 邮件链接令牌（v12.0）：
 * - 重置密码：32 字节随机 token，sha256 落 Redis（不落明文）、TTL 30 分钟、用后即焚；
 * - 退订：HMAC 签名 token（userId.过期时间.签名），无状态可验，180 天有效。
 */
import { createHash, randomBytes } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RedisClient } from '../../db/redis';

const RESET_TTL_SECONDS = 30 * 60;
const UNSUBSCRIBE_TTL_MS = 180 * 24 * 3600 * 1000;

function hashToken(token: string): string {
  // token 是高熵随机值，sha256 仅作"不落明文"摘要，无需慢哈希
  return createHash('sha256').update(token).digest('hex');
}

/** 重置密码一次性 token（Redis 存 sha256，key = reset_token:{sha256}，值 = userId） */
export class ResetTokenStore {
  constructor(private readonly redis: RedisClient) {}

  private key(tokenHash: string): string {
    return `reset_token:${tokenHash}`;
  }

  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(this.key(hashToken(token)), userId, 'EX', RESET_TTL_SECONDS);
    return token;
  }

  /** 一次性消费：命中即焚；未命中返回 null */
  async consume(token: string): Promise<string | null> {
    const key = this.key(hashToken(token));
    const value = await this.redis.eval(
      `local v = redis.call('GET', KEYS[1])
       if v then redis.call('DEL', KEYS[1]) end
       return v`,
      1,
      key,
    );
    return typeof value === 'string' && value ? value : null;
  }
}

/** 退订 token：`userId.expMs.sig`（sig = HMAC(masterKey, unsub:userId:expMs)） */
export function signUnsubscribeToken(crypto: CryptoService, userId: string, now = Date.now()): string {
  const exp = now + UNSUBSCRIBE_TTL_MS;
  const sig = crypto.hmac(`unsub:${userId}:${exp}`);
  return `${userId}.${exp}.${sig}`;
}

/** 校验退订 token，返回 userId；无效返回 null */
export function verifyUnsubscribeToken(crypto: CryptoService, token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!userId || !Number.isFinite(exp) || exp < Date.now() || !sig) return null;
  const expected = crypto.hmac(`unsub:${userId}:${exp}`);
  return crypto.hmacEquals(expected, sig) ? userId : null;
}
