import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateAnnouncementDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title!: string;

  @IsString({ message: '正文必须是字符串' })
  @IsNotEmpty({ message: '正文不能为空' })
  content!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'pinned 必须是布尔值' })
  pinned?: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'notify 必须是布尔值' })
  notify?: boolean;
}

export class UpdateAnnouncementDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '正文必须是字符串' })
  @IsNotEmpty({ message: '正文不能为空' })
  content?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'pinned 必须是布尔值' })
  pinned?: boolean;
}
