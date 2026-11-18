import { IsEmail } from 'class-validator';
import { CaptchaFields } from '../../../common/dto/captcha-fields';

/** 忘记密码（v12.0）：无论账号是否存在均返回 204（防账号枚举） */
export class ForgotPasswordDto extends CaptchaFields {
  @IsEmail({}, { message: '请输入合法的邮箱' })
  identifier!: string;
}
