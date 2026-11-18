/**
 * 邮件链接令牌（v12.0）单测：重置密码一次性 token（sha256 落 Redis）与退订 HMAC 签名 token。
 */
import { createHash } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RedisClient } from '../../db/redis';
import { FakeRedis } from '../../../test/fake-redis';
import { ResetTokenStore, signUnsubscribeToken, verifyUnsubscribeToken } from './link-tokens';

describe('ResetTokenStore（重置密码一次性 token）', () => {
  let fakeRedis: FakeRedis;
  let store: ResetTokenStore;

  beforeEach(() => {
    fakeRedis = new FakeRedis();
    store = new ResetTokenStore(fakeRedis as unknown as RedisClient);
  });

  it('issue/consume：一次性消费，二次消费返回 null', async () => {
    const token = await store.issue('user-1');

    expect(token).toBeTruthy();
    // sha256 落 Redis（不落明文），值为 userId
    const stored = await fakeRedis.get(`reset_token:${createHash('sha256').update(token).digest('hex')}`);
    expect(stored).toBe('user-1');

    await expect(store.consume(token)).resolves.toBe('user-1');
    await expect(store.consume(token)).resolves.toBeNull();
  });

  it('consume：未知 / 篡改 token 返回 null', async () => {
    await expect(store.consume('no-such-token')).resolves.toBeNull();

    const token = await store.issue('user-1');
    await expect(store.consume(`${token}x`)).resolves.toBeNull();
  });
});

describe('退订 token（signUnsubscribeToken / verifyUnsubscribeToken）', () => {
  const crypto = new CryptoService(Buffer.alloc(32, 7).toString('base64'));
  const DAY_MS = 24 * 3600 * 1000;

  it('sign→verify 往返返回 userId', () => {
    const token = signUnsubscribeToken(crypto, 'user-1');
    expect(verifyUnsubscribeToken(crypto, token)).toBe('user-1');
  });

  it('篡改签名 / 格式非法返回 null', () => {
    const token = signUnsubscribeToken(crypto, 'user-1');
    const [userId, exp, sig] = token.split('.');
    expect(verifyUnsubscribeToken(crypto, `${userId}.${exp}.${sig.slice(0, -1)}x`)).toBeNull();
    expect(verifyUnsubscribeToken(crypto, 'only-one-part')).toBeNull();
    expect(verifyUnsubscribeToken(crypto, 'a.b.c.d')).toBeNull();
    expect(verifyUnsubscribeToken(crypto, 'user-1.not-a-number.sig')).toBeNull();
  });

  it('超过 180 天有效期返回 null', () => {
    const expired = signUnsubscribeToken(crypto, 'user-1', Date.now() - 181 * DAY_MS);
    expect(verifyUnsubscribeToken(crypto, expired)).toBeNull();

    const fresh = signUnsubscribeToken(crypto, 'user-1', Date.now() - 179 * DAY_MS);
    expect(verifyUnsubscribeToken(crypto, fresh)).toBe('user-1');
  });
});
