import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: '当前密码必须是字符串' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  currentPassword!: string;

  @IsString({ message: '新密码必须是字符串' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  newPassword!: string;
}
