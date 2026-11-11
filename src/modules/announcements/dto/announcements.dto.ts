import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title!: string;

  @IsString({ message: '正文必须是字符串' })
  @IsNotEmpty({ message: '正文不能为空' })
  content!: string;

  @IsOptional()
  @IsBoolean({ message: 'pinned 必须是布尔值' })
  pinned?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'notify 必须是布尔值' })
  notify?: boolean;
}

export class UpdateAnnouncementDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '正文必须是字符串' })
  @IsNotEmpty({ message: '正文不能为空' })
  content?: string;

  @IsOptional()
  @IsBoolean({ message: 'pinned 必须是布尔值' })
  pinned?: boolean;
}
