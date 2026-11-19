import { IsEmail, IsIn } from 'class-validator';
import { CaptchaFields } from '../../../common/dto/captcha-fields';

/** 拉取邮件验证码（v12.0）：注册 / 换绑邮箱统一入口，前置图形验证码防轰炸 */
export class EmailCodeDto extends CaptchaFields {
  @IsEmail({}, { message: '请输入合法的邮箱' })
  email!: string;

  @IsIn(['register', 'rebind', 'password'], { message: 'purpose 仅支持 register / rebind / password' })
  purpose!: 'register' | 'rebind' | 'password';
}
