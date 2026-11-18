import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 一键退订通知邮件（v12.0）：token 化链接，无需登录 */
export class UnsubscribeDto {
  @IsString({ message: 'token 必须是字符串' })
  @IsNotEmpty({ message: '链接无效或已过期' })
  @MaxLength(256, { message: '链接无效或已过期' })
  token!: string;
}
