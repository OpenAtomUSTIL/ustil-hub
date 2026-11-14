import { IsString, MaxLength, MinLength } from 'class-validator';
import { CaptchaFields } from '../../../common/dto/captcha-fields';
import { IsPasswordComplex } from './is-password-complex';

export class ChangePasswordDto extends CaptchaFields {
  // 当前密码不加复杂度：存量密码可能不满足复杂度规则
  @IsString({ message: '当前密码必须是字符串' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  currentPassword!: string;

  @IsString({ message: '新密码必须是字符串' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  @IsPasswordComplex()
  newPassword!: string;
}
