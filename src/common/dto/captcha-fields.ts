import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 敏感操作图形验证码字段（v6.0）：注册 / 登录 / 改密 / 换绑 / 转正统一必填 */
export class CaptchaFields {
  @IsString({ message: 'captchaId 必须是字符串' })
  @IsNotEmpty({ message: 'captchaId 不能为空' })
  @MaxLength(64, { message: 'captchaId 过长' })
  captchaId!: string;

  @IsString({ message: 'captchaCode 必须是字符串' })
  @IsNotEmpty({ message: 'captchaCode 不能为空' })
  @MaxLength(16, { message: 'captchaCode 过长' })
  captchaCode!: string;
}
