import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CaptchaController } from './captcha.controller';
import { CaptchaService } from './captcha.service';

const CAPTCHA_ERROR = '验证码错误或已失效';

import { inflateSync } from 'node:zlib';
import * as captchaImage from './captcha-image';

function background(image: string): string {
  const png = Buffer.from(image.split(',')[1], 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const colors = new Map<string, number>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 3 + 1) + 1 + x * 3;
    const color = pixels.subarray(at, at + 3).toString('hex');
    colors.set(color, (colors.get(color) ?? 0) + 1);
  }
  return [...colors.entries()].sort((a, b) => b[1] - a[1])[0][0];
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
    jest.spyOn(captchaImage, 'randomCaptchaCode').mockReturnValue('ABCDE');
    service = new CaptchaService(redis);
  });

  afterEach(() => jest.restoreAllMocks());

  it('create：返回 captchaId + PNG data URI，答案以 sha256 落 Redis（不存明文）并带 EX TTL', async () => {
    const result = await service.create();

    expect(result.captchaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.image.startsWith('data:image/png;base64,')).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = redis.set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(`captcha:${result.captchaId}`);
    expect(mode).toBe('EX');
    expect(ttl).toBe(5 * 60);

    // 明文不出 Redis：存储值是 sha256 hex，且等于图片码（小写）的哈希
    const code = 'ABCDE';
    expect(code.length).toBeGreaterThan(0);
    expect(value).not.toBe(code);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(value).toBe(sha256(code.toLowerCase()));
  });

  it('create()：默认浅色调色板（浅底 #f5f4ed），不传主题向后兼容', async () => {
    const result = await service.create();

    expect(background(result.image)).toBe('f5f4ed');
  });

  it("create('dark')：深色调色板（深底 #232220 + 亮字符），答案 sha256 落 Redis 语义不变", async () => {
    const result = await service.create('dark');

    const color = background(result.image);
    expect(result.image.startsWith('data:image/png;base64,')).toBe(true);
    expect(color).toBe('232220');

    // 深色只换配色，安全语义不变：答案仍 sha256 + EX TTL、不落明文
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = redis.set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(`captcha:${result.captchaId}`);
    expect(mode).toBe('EX');
    expect(ttl).toBe(5 * 60);
    const code = 'ABCDE';
    expect(value).toBe(sha256(code.toLowerCase()));
    expect(value).not.toBe(code);
  });

  it('controller：query theme 仅认 dark，其余值/大小写不符一律当浅色且不报错', async () => {
    const controller = new CaptchaController(service);

    const dark = await controller.create('dark');
    expect(background(dark.image)).toBe('232220');

    const weird = await controller.create('DARK');
    expect(background(weird.image)).toBe('f5f4ed');

    const none = await controller.create(undefined);
    expect(background(none.image)).toBe('f5f4ed');
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
  it('图片响应不能携带可直接提取答案的 SVG 文本', async () => {
    const result = await service.create();
    expect(result.image).toMatch(/^data:image\/png;base64,/);
    const image = Buffer.from(result.image.split(',')[1], 'base64');
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(image.toString('utf8')).not.toContain('<text');
  });

  it('验证码图片获取超限时不能再写入答案或生成图片', async () => {
    redis.eval.mockResolvedValue(61);
    await expect(service.create('light', '198.51.100.10')).rejects.toMatchObject({ status: 429 });
    expect(redis.set).not.toHaveBeenCalled();
  });

});
