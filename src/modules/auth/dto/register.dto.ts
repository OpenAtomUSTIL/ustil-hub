import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CaptchaFields } from '../../../common/dto/captcha-fields';
import { IsPasswordComplex } from './is-password-complex';
import { IsSameAs } from './is-same-as';

export class RegisterDto extends CaptchaFields {
  // v12.0：仅允许邮箱注册（手机号改为可选绑定），identifier 语义收窄为邮箱
  @IsEmail({}, { message: '请输入合法的邮箱' })
  identifier!: string;

  // 邮件验证码（发往 identifier 邮箱，purpose=register，一次性消费）
  @IsString({ message: '验证码必须是字符串' })
  @IsNotEmpty({ message: '验证码不能为空' })
  @MaxLength(16, { message: '验证码过长' })
  emailCode!: string;

  @IsString({ message: '密码必须是字符串' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  @IsPasswordComplex()
  password!: string;

  // 确认密码：与 password 一致（v6.0）
  @IsString({ message: '确认密码必须是字符串' })
  @IsNotEmpty({ message: '确认密码不能为空' })
  @IsSameAs('password', { message: '两次输入的密码不一致' })
  passwordConfirm!: string;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '昵称必须是字符串' })
  @IsNotEmpty({ message: '昵称不能为空' })
  @MaxLength(50, { message: '昵称不能超过 50 个字符' })
  nickname!: string;

  // 邀请码：有效则注册为 MEMBER，无码注册为 VISITOR
  @IsOptional()
  @IsString({ message: '邀请码必须是字符串' })
  @MaxLength(64, { message: '邀请码过长' })
  inviteCode?: string;
}
