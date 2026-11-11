import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'identifier 必须是字符串' })
  @IsNotEmpty({ message: 'identifier 不能为空' })
  @MaxLength(255, { message: 'identifier 过长' })
  identifier!: string;

  @IsString({ message: '密码必须是字符串' })
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  password!: string;
}
