/**
 * e2e 用内存版 Redis 桩（Map 实现）：基础命令 + 按 KEYS 前缀分发的 Lua 语义模拟。
 * 关键 Lua：
 *  - `captcha:*` / `email_code:*`（v12.0 邮件验证码，同一语义）：比对 sha256 答案 → 命中即焚（DEL 主键+限次键）/ 失败限次（INCR，达上限作废）
 *  - `register_attempt:*` / `login_fail:*`：INCR + 首次 EXPIRE（限流计数）
 *  - `email_code_rate_*`（v12.0 拉码限频）：双键 INCR，分钟/小时任一超限返回 0
 *  - `reset_token:*`（v12.0 重置密码一次性 token）：GET 命中即焚
 * 另覆盖 RefreshTokenStore.rotate 的 `refresh:*` 轮换脚本（DEL 旧 jti 命中才登记新 jti）。
 * TTL 不做虚拟时钟：过期场景由测试显式 del key 模拟（unit 层已断言 set 带 EX）。
 */
export class FakeRedis {
  private store = new Map<string, string>();

  clear(): void {
    this.store.clear();
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode?: string, _ttl?: number): Promise<'OK'> {
    this.store.set(key, String(value));
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  }

  async expire(_key: string, _ttl: number): Promise<number> {
    return 1;
  }

  async scan(_cursor: string, ...args: Array<string | number>): Promise<[string, string[]]> {
    const matchAt = args.indexOf('MATCH');
    const pattern = matchAt >= 0 ? String(args[matchAt + 1]) : '*';
    const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(`^${source}$`);
    return ['0', [...this.store.keys()].filter((key) => re.test(key))];
  }

  /** 按 KEYS[1] 前缀分发模拟各业务 Lua 脚本 */
  async eval(_script: string, numKeys: number, ...args: Array<string | number>): Promise<number | string | null> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);
    const [firstKey] = keys;
    if (firstKey.startsWith('captcha:')) return this.evalCaptcha(keys, argv);
    if (firstKey.startsWith('captcha_rate:') || firstKey.startsWith('register_attempt:') || firstKey.startsWith('login_fail:')) {
      return this.evalIncrWithTtl(keys, argv);
    }
    if (firstKey.startsWith('refresh:')) return this.evalRefreshRotate(keys, argv);
    // v12.0 事务邮件
    if (firstKey.startsWith('email_code_rate_')) return this.evalEmailCodeRate(keys, argv);
    if (firstKey.startsWith('email_code:')) return this.evalCaptcha(keys, argv);
    if (firstKey.startsWith('reset_token:')) return this.evalResetToken(keys);
    throw new Error(`FakeRedis.eval: unsupported script for key "${firstKey}"`);
  }

  /** captcha / email_code 校验 Lua：KEYS[1]=主键 KEYS[2]=attempts 键；ARGV=sha256答案/TTL/限次 */
  private evalCaptcha(keys: string[], argv: string[]): number {
    const [key, attemptsKey] = keys;
    const [hash, , maxAttempts] = argv;
    const current = this.store.get(key);
    if (current === undefined) return 0;
    if (current === hash) {
      this.store.delete(key);
      this.store.delete(attemptsKey);
      return 1;
    }
    const attempts = Number(this.store.get(attemptsKey) ?? '0') + 1;
    this.store.set(attemptsKey, String(attempts));
    if (attempts >= Number(maxAttempts)) this.store.delete(key);
    return 0;
  }

  /** 限流计数 Lua：INCR + 首次 EXPIRE，返回计数 */
  private evalIncrWithTtl(keys: string[], _argv: string[]): number {
    const key = keys[0];
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  }

  /** refresh 轮换 Lua：旧 jti 不存在返回 0（复用视为窃取），否则登记新 jti 返回 1 */
  private evalRefreshRotate(keys: string[], _argv: string[]): number {
    const [oldKey, newKey] = keys;
    if (this.store.delete(oldKey)) {
      this.store.set(newKey, '1');
      return 1;
    }
    return 0;
  }

  /** 拉码限频 Lua（v12.0）：KEYS=分钟键/小时键；ARGV=分钟TTL/小时TTL/分钟上限/小时上限；口径=实际发出封数（被分钟窗口拦下的不计小时额度），超限返回 0 */
  private evalEmailCodeRate(keys: string[], argv: string[]): number {
    const [minKey, hourKey] = keys;
    const [, , limitMin, limitHour] = argv;
    const min = Number(this.store.get(minKey) ?? '0') + 1;
    this.store.set(minKey, String(min));
    if (min > Number(limitMin)) return 0;
    const hour = Number(this.store.get(hourKey) ?? '0');
    if (hour >= Number(limitHour)) return 0;
    this.store.set(hourKey, String(hour + 1));
    return 1;
  }

  /** 重置密码一次性 token Lua（v12.0）：GET 命中即焚，返回 userId 或 null */
  private evalResetToken(keys: string[]): string | null {
    const value = this.store.get(keys[0]);
    if (value === undefined) return null;
    this.store.delete(keys[0]);
    return value;
  }
}
