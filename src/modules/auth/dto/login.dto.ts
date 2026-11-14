import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { CaptchaFields } from '../../../common/dto/captcha-fields';

export class LoginDto extends CaptchaFields {
  // 登录不限格式（邮箱/手机号均可），由后端统一「账号或密码错误」
  @IsString({ message: 'identifier 必须是字符串' })
  @IsNotEmpty({ message: 'identifier 不能为空' })
  @MaxLength(255, { message: 'identifier 过长' })
  identifier!: string;

  // 登录不加复杂度：存量密码可能不满足复杂度规则
  @IsString({ message: '密码必须是字符串' })
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  password!: string;
}
