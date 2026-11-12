import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TagsField } from '../../../common/dto/tags-field';
import { ResourceCategory } from '../../../db/schema';

export class CreateResourceDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title!: string;

  @IsOptional()
  @IsString({ message: '描述必须是字符串' })
  @MaxLength(2000, { message: '描述不能超过 2000 个字符' })
  description?: string;

  @IsString({ message: 'url 必须是字符串' })
  @IsNotEmpty({ message: 'url 不能为空' })
  @MaxLength(2048, { message: 'url 不能超过 2048 个字符' })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_valid_protocol: true, require_tld: false },
    { message: 'url 必须是合法的 HTTP 或 HTTPS 链接' },
  )
  url!: string;

  @IsIn(['GITHUB', 'EXAM', 'EBOOK', 'DOCUMENT', 'OTHER'], { message: 'category 取值非法' })
  category!: ResourceCategory;

  @TagsField()
  tags?: string[];
}

export class UpdateResourceDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '描述必须是字符串' })
  @MaxLength(2000, { message: '描述不能超过 2000 个字符' })
  description?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'url 必须是字符串' })
  @IsNotEmpty({ message: 'url 不能为空' })
  @MaxLength(2048, { message: 'url 不能超过 2048 个字符' })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_valid_protocol: true, require_tld: false },
    { message: 'url 必须是合法的 HTTP 或 HTTPS 链接' },
  )
  url?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['GITHUB', 'EXAM', 'EBOOK', 'DOCUMENT', 'OTHER'], { message: 'category 取值非法' })
  category?: ResourceCategory;

  @TagsField()
  tags?: string[];
}
