import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CaptchaFields } from '../../../common/dto/captcha-fields';

export class RedeemInviteCodeDto extends CaptchaFields {
  @IsString({ message: '邀请码必须是字符串' })
  @IsNotEmpty({ message: '邀请码不能为空' })
  @MaxLength(64, { message: '邀请码过长' })
  inviteCode!: string;
}
