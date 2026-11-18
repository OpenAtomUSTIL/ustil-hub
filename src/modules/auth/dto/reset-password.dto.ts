import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { IsPasswordComplex } from './is-password-complex';
import { IsSameAs } from './is-same-as';

/** 重置密码（v12.0）：凭一次性邮件链接 token 设置新密码，成功后全会话失效 */
export class ResetPasswordDto {
  @IsString({ message: 'token 必须是字符串' })
  @IsNotEmpty({ message: '链接无效或已过期' })
  @MaxLength(128, { message: '链接无效或已过期' })
  token!: string;

  @IsString({ message: '新密码必须是字符串' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  @IsPasswordComplex()
  newPassword!: string;

  @IsString({ message: '确认密码必须是字符串' })
  @IsNotEmpty({ message: '确认密码不能为空' })
  @IsSameAs('newPassword', { message: '两次输入的密码不一致' })
  newPasswordConfirm!: string;
}
