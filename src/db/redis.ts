import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REFRESH_TOKEN_STORE = 'REFRESH_TOKEN_STORE';

export type RedisClient = Pick<Redis, 'get' | 'set' | 'del' | 'incr' | 'expire' | 'scan' | 'eval'>;

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }
  return redisInstance;
}

export const redisProvider = {
  provide: REDIS_CLIENT,
  useFactory: getRedis,
};

// refresh_token jti 白名单存储（AGENTS.md §11.2）
export class RefreshTokenStore {
  constructor(private readonly redis: RedisClient) {}

  private key(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  async register(userId: string, jti: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(userId, jti), '1', 'EX', ttlSeconds);
  }

  async rotate(userId: string, oldJti: string, newJti: string, ttlSeconds: number): Promise<boolean> {
    // 检查、消费旧 jti 与登记新 jti 必须一次完成；复用吊销不能漏掉尚未登记的新 token。
    const result = await this.redis.eval(
      `if redis.call('DEL', KEYS[1]) == 0 then return 0 end
       redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
       return 1`,
      2,
      this.key(userId, oldJti),
      this.key(userId, newJti),
      ttlSeconds,
    );
    return Number(result) === 1;
  }

  async revokeAll(userId: string): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}

export const refreshTokenStoreProvider = {
  provide: REFRESH_TOKEN_STORE,
  useFactory: (redis: RedisClient) => new RefreshTokenStore(redis),
  inject: [REDIS_CLIENT],
};
