import { ValidateIf, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '昵称必须是字符串' })
  @MaxLength(50, { message: '昵称不能超过 50 个字符' })
  nickname?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '头像地址必须是字符串' })
  @MaxLength(1024, { message: '头像地址过长' })
  avatarUrl?: string;
}
