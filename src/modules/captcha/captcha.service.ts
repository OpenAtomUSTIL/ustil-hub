import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { REDIS_CLIENT, RedisClient } from '../../db/redis';
import { randomCaptchaCode, renderCaptchaSvg, type CaptchaTheme } from './captcha-svg';

const CAPTCHA_TTL_SECONDS = 5 * 60;
const CAPTCHA_MAX_ATTEMPTS = 3;
/** 统一文案：不区分「过期 / 错误 / 已消费」，避免暴露校验细节 */
const CAPTCHA_ERROR = '验证码错误或已失效';

/**
 * 敏感操作图形验证码（v6.0）：自绘 SVG，答案以 sha256 落 Redis（AGENTS.md §16.1 不落明文），
 * 短 TTL + 一次性消费 + 单 captchaId 失败限次；与既有 IP 限流叠加而非替代。
 */
@Injectable()
export class CaptchaService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  private key(captchaId: string): string {
    return `captcha:${captchaId}`;
  }

  private attemptsKey(captchaId: string): string {
    return `captcha:attempts:${captchaId}`;
  }

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** theme 仅决定 SVG 配色（深/浅），答案生成与存储语义不受影响 */
  async create(theme: CaptchaTheme = 'light'): Promise<{ captchaId: string; image: string }> {
    const captchaId = randomUUID();
    const code = randomCaptchaCode().toLowerCase();
    await this.redis.set(this.key(captchaId), this.hash(code), 'EX', CAPTCHA_TTL_SECONDS);
    const svg = renderCaptchaSvg(code.toUpperCase(), theme);
    return {
      captchaId,
      image: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    };
  }

  /** 统一校验入口：命中即焚（原子消费），失败限次后作废；不命中一律抛统一文案 */
  async validate(captchaId: string, captchaCode: string): Promise<void> {
    const id = captchaId.trim();
    const code = captchaCode.trim().toLowerCase();
    if (!id || !code) {
      throw new BadRequestException(CAPTCHA_ERROR);
    }
    const consumed = await this.redis.eval(
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
      this.key(id),
      this.attemptsKey(id),
      this.hash(code),
      CAPTCHA_TTL_SECONDS,
      CAPTCHA_MAX_ATTEMPTS,
    );
    if (Number(consumed) !== 1) {
      throw new BadRequestException(CAPTCHA_ERROR);
    }
  }
}
