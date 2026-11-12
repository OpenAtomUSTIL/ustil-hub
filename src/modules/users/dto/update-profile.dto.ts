import { Transform } from 'class-transformer';
import { ValidateIf, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '昵称必须是字符串' })
  @IsNotEmpty({ message: '昵称不能为空' })
  @MaxLength(50, { message: '昵称不能超过 50 个字符' })
  nickname?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '头像地址必须是字符串' })
  @MaxLength(1024, { message: '头像地址过长' })
  avatarUrl?: string;
}
