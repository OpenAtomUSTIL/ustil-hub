import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { isPasswordComplex } from './is-password-complex';

/** 密码复杂度（v6.0）：8~128 位且大写/小写/数字/符号四类至少两类 */
describe('isPasswordComplex', () => {
  it('两类临界通过：小写+数字 8 位、大写+符号 8 位、四类 128 位', () => {
    expect(isPasswordComplex('abcdefg1')).toBe(true);
    expect(isPasswordComplex('ABCDEFG!')).toBe(true);
    expect(isPasswordComplex(`A1${'a'.repeat(126)}`)).toBe(true);
  });

  it('单类拒绝：纯小写 / 纯大写 / 纯数字 / 纯符号', () => {
    expect(isPasswordComplex('abcdefgh')).toBe(false);
    expect(isPasswordComplex('ABCDEFGH')).toBe(false);
    expect(isPasswordComplex('12345678')).toBe(false);
    expect(isPasswordComplex('!!!!!!!!')).toBe(false);
  });

  it('长度边界：7 位与 129 位拒绝，8 位与 128 位通过', () => {
    expect(isPasswordComplex('abcde12')).toBe(false);
    expect(isPasswordComplex(`A1${'a'.repeat(127)}`)).toBe(false);
    expect(isPasswordComplex('abcde123')).toBe(true);
    expect(isPasswordComplex(`A1${'a'.repeat(126)}`)).toBe(true);
  });

  it('非字符串拒绝', () => {
    expect(isPasswordComplex(12345678)).toBe(false);
    expect(isPasswordComplex(null)).toBe(false);
    expect(isPasswordComplex(undefined)).toBe(false);
  });
});

describe('RegisterDto 校验（class-validator）', () => {
  const base = {
    captchaId: 'captcha-1',
    captchaCode: 'ABCDE',
    identifier: 'a@example.com',
    password: 'password123',
    passwordConfirm: 'password123',
    nickname: '测试用户',
  };

  it('合法注册体通过校验', async () => {
    const dto = plainToInstance(RegisterDto, base);
    expect(await validate(dto)).toEqual([]);
  });

  it('两次密码不一致：400 文案「两次输入的密码不一致」', async () => {
    const dto = plainToInstance(RegisterDto, { ...base, passwordConfirm: 'other-pass-1' });
    const errors = await validate(dto);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain('两次输入的密码不一致');
  });

  it('弱密码（单类字符）：文案列出四类至少两类要求', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...base,
      password: 'abcdefgh',
      passwordConfirm: 'abcdefgh',
    });
    const errors = await validate(dto);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain('密码需包含大写字母、小写字母、数字、符号中的至少两类');
  });

  it('captchaId / captchaCode 缺失：校验失败（敏感字段必填）', async () => {
    const dto = plainToInstance(RegisterDto, {
      identifier: 'a@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
      nickname: '测试用户',
    });
    const errors = await validate(dto);
    const properties = errors.map((e) => e.property);
    expect(properties).toEqual(expect.arrayContaining(['captchaId', 'captchaCode']));
  });
});
