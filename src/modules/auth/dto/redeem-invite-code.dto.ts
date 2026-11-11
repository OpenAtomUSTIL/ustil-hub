import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RedeemInviteCodeDto {
  @IsString({ message: '邀请码必须是字符串' })
  @IsNotEmpty({ message: '邀请码不能为空' })
  @MaxLength(64, { message: '邀请码过长' })
  inviteCode!: string;
}
