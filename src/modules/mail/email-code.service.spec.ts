/**
 * 邮件验证码（v12.0）单测：真实 CryptoService + FakeRedis（模拟 issue/validate Lua 语义），
 * 发信走 MailService 桩（从 send 入参捕获验证码，验证「码只进邮件、库内只落 sha256」）。
 */
import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RedisClient } from '../../db/redis';
import { FakeRedis } from '../../../test/fake-redis';
import { EmailCodeService } from './email-code.service';
import { MailService } from './mail.service';
import type { AppConfig } from '../../config/configuration';
import type { Queue } from 'bullmq';
import type { MailJobData } from './mail.types';

const hmacOf = (crypto: CryptoService, email: string): string => crypto.hmac(email.toLowerCase());
const sha256 = (code: string): string => createHash('sha256').update(code).digest('hex');

describe('EmailCodeService', () => {
  const crypto = new CryptoService(Buffer.alloc(32, 7).toString('base64'));
  const mailService = { send: jest.fn(), driver: 'none' };
  let fakeRedis: FakeRedis;
  let service: EmailCodeService;

  /** 从发信桩捕获的 verify-code 邮件变量（验证码只进邮件，不返回调用方） */
  function sentCode(): string {
    const calls = mailService.send.mock.calls as unknown as [string, string, { code: string }][];
    const [, kind, vars] = calls[calls.length - 1];
    expect(kind).toBe('verify-code');
    expect(vars.code).toMatch(/^\d{6}$/);
    return vars.code;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    fakeRedis = new FakeRedis();
    service = new EmailCodeService(
      fakeRedis as unknown as RedisClient,
      crypto,
      mailService as unknown as MailService,
    );
  });

  it('预检查不消耗正确邮件码，最终提交原子消费且不能再次使用', async () => {
    await service.issue('a@example.com', 'register');
    const code = sentCode();
    await service.check('a@example.com', 'register', code);
    await service.check('a@example.com', 'register', code);
    await service.validate('a@example.com', 'register', code);
    await expect(service.check('a@example.com', 'register', code)).rejects.toMatchObject({ status: 400 });
  });

  it('issue：生成 6 位码存 sha256（不落明文）并发 verify-code 邮件', async () => {
    await service.issue('A@Example.com', 'register');

    expect(mailService.send).toHaveBeenCalledTimes(1);
    const [to, kind, vars] = mailService.send.mock.calls[0] as unknown as [
      string,
      string,
      { code: string; purpose: string; expiresMinutes: string },
    ];
    expect(to).toBe('A@Example.com');
    expect(kind).toBe('verify-code');
    expect(vars.purpose).toBe('注册账号');
    expect(vars.expiresMinutes).toBe('10');

    const stored = await fakeRedis.get(`email_code:register:${hmacOf(crypto, 'a@example.com')}`);
    expect(stored).toBe(sha256(vars.code));
    expect(stored).not.toBe(vars.code);
  });

  it('issue：1 分钟内第 2 封 429（分钟窗口）', async () => {
    await service.issue('a@example.com', 'register');
    await expect(service.issue('a@example.com', 'register')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(mailService.send).toHaveBeenCalledTimes(1);
  });

  it('issue：1 小时 5 封上限（小时窗口）', async () => {
    const minKey = `email_code_rate_min:${hmacOf(crypto, 'a@example.com')}`;

    // 每次拉码后清分钟计数模拟窗口滑过；小时计数累计，第 6 次 429
    for (let i = 0; i < 5; i++) {
      await service.issue('a@example.com', 'register');
      await fakeRedis.del(minKey);
    }
    expect(mailService.send).toHaveBeenCalledTimes(5);
    await expect(service.issue('a@example.com', 'register')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(mailService.send).toHaveBeenCalledTimes(5);
  });

  it('validate：正确码一次性消费，二次使用 400', async () => {
    await service.issue('a@example.com', 'register');
    const code = sentCode();

    await expect(service.validate('a@example.com', 'register', code)).resolves.toBeUndefined();
    await expect(service.validate('a@example.com', 'register', code)).rejects.toThrow(
      '验证码错误或已失效',
    );
  });

  it('validate：错 3 次作废，正确码也随之失效', async () => {
    await service.issue('a@example.com', 'register');
    const code = sentCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 3; i++) {
      await expect(service.validate('a@example.com', 'register', wrong)).rejects.toThrow(
        '验证码错误或已失效',
      );
    }
    // 三次错误后码已被作废（DEL），正确码同样失效
    await expect(service.validate('a@example.com', 'register', code)).rejects.toThrow(
      '验证码错误或已失效',
    );
  });

  it('validate：不存在 / 过期 / 空码 / 跨用途均 400 统一文案', async () => {
    // 未发码（不存在）
    await expect(service.validate('a@example.com', 'register', '123456')).rejects.toThrow(
      '验证码错误或已失效',
    );

    // 过期：TTL 过后键消失，显式 del 模拟
    await service.issue('a@example.com', 'register');
    const code = sentCode();
    await fakeRedis.del(`email_code:register:${hmacOf(crypto, 'a@example.com')}`);
    await expect(service.validate('a@example.com', 'register', code)).rejects.toThrow(
      '验证码错误或已失效',
    );

    // 空码
    await expect(service.validate('a@example.com', 'register', '   ')).rejects.toThrow(
      '验证码错误或已失效',
    );

    // 跨用途：register 码不能用于 rebind（清限频计数后重新发码，聚焦校验语义）
    await fakeRedis.del(`email_code_rate_min:${hmacOf(crypto, 'a@example.com')}`);
    await service.issue('a@example.com', 'register');
    await expect(service.validate('a@example.com', 'rebind', sentCode())).rejects.toThrow(
      '验证码错误或已失效',
    );
  });
});


describe('验证码邮件发送状态', () => {
  const vars = { code: '123456' };
  it('邮件功能未启用时验证码请求必须失败，不能假报成功', async () => {
    const service = new MailService({ mail: { driver: 'none' } } as AppConfig, null);
    await expect(service.send('user@example.test', 'verify-code', vars)).rejects.toMatchObject({ status: 503 });
  });
  it('验证码入队失败必须返回可恢复的错误', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('queue unavailable')) };
    const service = new MailService({ mail: { driver: 'api' } } as AppConfig, queue as unknown as Queue<MailJobData>);
    await expect(service.send('user@example.test', 'verify-code', vars)).rejects.toMatchObject({ status: 503 });
    await expect(service.send('user@example.test', 'notice-reply', vars)).resolves.toBeUndefined();
  });
});
