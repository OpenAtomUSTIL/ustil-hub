import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CaptchaController } from './captcha.controller';
import { CaptchaService } from './captcha.service';

const CAPTCHA_ERROR = '验证码错误或已失效';

/** data URI → SVG 文本（走真实渲染产物） */
function decodeSvg(image: string): string {
  return Buffer.from(image.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');
}

/** 从自绘 SVG 中还原验证码字符（与 e2e 同款解析） */
function extractCode(image: string): string {
  return [...decodeSvg(image).matchAll(/<text[^>]*>([^<])<\/text>/g)].map((m) => m[1]).join('');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('CaptchaService', () => {
  let service: CaptchaService;
  const redis = {
    eval: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    scan: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaptchaService(redis);
  });

  it('create：返回 captchaId + SVG data URI，答案以 sha256 落 Redis（不存明文）并带 EX TTL', async () => {
    const result = await service.create();

    expect(result.captchaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.image.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = redis.set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(`captcha:${result.captchaId}`);
    expect(mode).toBe('EX');
    expect(ttl).toBe(5 * 60);

    // 明文不出 Redis：存储值是 sha256 hex，且等于图片码（小写）的哈希
    const code = extractCode(result.image);
    expect(code.length).toBeGreaterThan(0);
    expect(value).not.toBe(code);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(value).toBe(sha256(code.toLowerCase()));
  });

  it('create()：默认浅色调色板（浅底 #f5f4ed），不传主题向后兼容', async () => {
    const result = await service.create();

    const svg = decodeSvg(result.image);
    expect(svg).toContain('fill="#f5f4ed"');
    expect(svg).not.toContain('#232220');
  });

  it("create('dark')：深色调色板（深底 #232220 + 亮字符），答案 sha256 落 Redis 语义不变", async () => {
    const result = await service.create('dark');

    const svg = decodeSvg(result.image);
    expect(result.image.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(svg).toContain('fill="#232220"');
    expect(svg).not.toContain('#f5f4ed');

    // 深色只换配色，安全语义不变：答案仍 sha256 + EX TTL、不落明文
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = redis.set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(`captcha:${result.captchaId}`);
    expect(mode).toBe('EX');
    expect(ttl).toBe(5 * 60);
    const code = extractCode(result.image);
    expect(value).toBe(sha256(code.toLowerCase()));
    expect(value).not.toBe(code);
  });

  it('controller：query theme 仅认 dark，其余值/大小写不符一律当浅色且不报错', async () => {
    const controller = new CaptchaController(service);

    const dark = await controller.create('dark');
    expect(decodeSvg(dark.image)).toContain('fill="#232220"');

    const weird = await controller.create('DARK');
    expect(decodeSvg(weird.image)).toContain('fill="#f5f4ed"');

    const none = await controller.create(undefined);
    expect(decodeSvg(none.image)).toContain('fill="#f5f4ed"');
  });

  it('validate 成功：命中即焚（Lua 原子消费），入参 trim + 小写后比对哈希', async () => {
    redis.eval.mockResolvedValue(1);

    await expect(service.validate(' captcha-1 ', 'AbC 12')).resolves.toBeUndefined();

    expect(redis.eval).toHaveBeenCalledTimes(1);
    const args = redis.eval.mock.calls[0] as unknown[];
    // KEYS：captcha:{id} + captcha:attempts:{id}；ARGV：sha256(小写答案) + TTL + 限次
    expect(args[1]).toBe(2);
    expect(args[2]).toBe('captcha:captcha-1');
    expect(args[3]).toBe('captcha:attempts:captcha-1');
    expect(args[4]).toBe(sha256('abc 12'));
    expect(args[5]).toBe(5 * 60);
    expect(args[6]).toBe(3);
  });

  it('validate 失败：Lua 返回 0 抛 400，统一文案「验证码错误或已失效」', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(service.validate('captcha-1', 'WRONG')).rejects.toThrow(BadRequestException);
    await expect(service.validate('captcha-1', 'WRONG')).rejects.toThrow(CAPTCHA_ERROR);
  });

  it('validate 空入参：同文案 400 且不访问 Redis', async () => {
    await expect(service.validate('', 'ABCD2')).rejects.toThrow(CAPTCHA_ERROR);
    await expect(service.validate('captcha-1', '   ')).rejects.toThrow(CAPTCHA_ERROR);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('validate 消费失败（验证码已过期/已用过/限次作废）：不区分细节，统一文案', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(service.validate('expired-id', 'ABCD2')).rejects.toThrow(CAPTCHA_ERROR);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'captcha:expired-id',
      'captcha:attempts:expired-id',
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
