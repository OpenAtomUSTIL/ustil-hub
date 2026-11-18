/**
 * 邮件验证码（v12.0）：6 位数字码，sha256 落 Redis（不落明文，AGENTS §16.1）、
 * 一次性消费、失败限次（对齐 CaptchaService 口径）+ 拉码限频（1 分钟 1 封 / 1 小时 5 封）。
 * 收件地址进 Redis key 前先 HMAC（不落明文邮箱）。
 */
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import { REDIS_CLIENT, RedisClient } from '../../db/redis';
import { MailService } from './mail.service';

export type EmailCodePurpose = 'register' | 'rebind';

const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 3;
const RATE_WINDOW_MIN_SECONDS = 60;
const RATE_WINDOW_HOUR_SECONDS = 3600;
const RATE_LIMIT_MIN = 1;
const RATE_LIMIT_HOUR = 5;
/** 统一文案：不区分「过期 / 错误 / 已消费」，避免暴露校验细节 */
const CODE_ERROR = '验证码错误或已失效';

const PURPOSE_TEXT: Record<EmailCodePurpose, string> = {
  register: '注册账号',
  rebind: '更换绑定邮箱',
};

@Injectable()
export class EmailCodeService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    private readonly crypto: CryptoService,
    private readonly mailService: MailService,
  ) {}

  private codeKey(purpose: EmailCodePurpose, hmac: string): string {
    return `email_code:${purpose}:${hmac}`;
  }

  private attemptsKey(purpose: EmailCodePurpose, hmac: string): string {
    return `email_code:attempts:${purpose}:${hmac}`;
  }

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** 生成并发送验证码；限频命中抛 429。验证码只进邮件，不返回给调用方 */
  async issue(email: string, purpose: EmailCodePurpose): Promise<void> {
    const hmac = this.crypto.hmac(email.toLowerCase());
    // 限频口径 = 实际发出的封数（被分钟窗口拦下的请求不消耗小时额度）
    const allowed = Number(await this.redis.eval(
      `local min = redis.call('INCR', KEYS[1])
       if min == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       if min > tonumber(ARGV[3]) then return 0 end
       local hour = redis.call('GET', KEYS[2])
       if hour and tonumber(hour) >= tonumber(ARGV[4]) then return 0 end
       local count = redis.call('INCR', KEYS[2])
       if count == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
       return 1`,
      2,
      `email_code_rate_min:${hmac}`,
      `email_code_rate_hour:${hmac}`,
      RATE_WINDOW_MIN_SECONDS,
      RATE_WINDOW_HOUR_SECONDS,
      RATE_LIMIT_MIN,
      RATE_LIMIT_HOUR,
    ));
    if (allowed !== 1) {
      throw new HttpException('邮件发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await this.redis.set(this.codeKey(purpose, hmac), this.hash(code), 'EX', CODE_TTL_SECONDS);
    await this.redis.del(this.attemptsKey(purpose, hmac));
    await this.mailService.send(email, 'verify-code', {
      code,
      purpose: PURPOSE_TEXT[purpose],
      expiresMinutes: String(CODE_TTL_SECONDS / 60),
    });
  }

  /** 校验并一次性消费验证码；失败限次后作废（与 CaptchaService 同一 Lua 语义） */
  async validate(email: string, purpose: EmailCodePurpose, code: string): Promise<void> {
    const hmac = this.crypto.hmac(email.toLowerCase());
    const trimmed = code.trim();
    if (!trimmed) {
      throw new HttpException(CODE_ERROR, HttpStatus.BAD_REQUEST);
    }
    const consumed = Number(await this.redis.eval(
      `local current = redis.call('GET', KEYS[1])
       if current == ARGV[1] then
         redis.call('DEL', KEYS[1], KEYS[2])
         return 1
       end
       if current then
         local attempts = redis.call('INCR', KEYS[2])
         if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
         if attempts >= tonumber(ARGV[3]) then redis.call('DEL', KEYS[1]) end
       end
       return 0`,
      2,
      this.codeKey(purpose, hmac),
      this.attemptsKey(purpose, hmac),
      this.hash(trimmed),
      CODE_TTL_SECONDS,
      MAX_ATTEMPTS,
    ));
    if (consumed !== 1) {
      throw new HttpException(CODE_ERROR, HttpStatus.BAD_REQUEST);
    }
  }
}
