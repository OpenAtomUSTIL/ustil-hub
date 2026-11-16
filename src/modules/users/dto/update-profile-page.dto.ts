import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

class PinnedItemDto {
  @IsIn(['ARTICLE', 'ISSUE', 'RESOURCE'], { message: '置顶类型必须是 ARTICLE/ISSUE/RESOURCE' })
  type!: 'ARTICLE' | 'ISSUE' | 'RESOURCE';

  @IsUUID(undefined, { message: '置顶 ID 必须是 UUID' })
  id!: string;
}

export class UpdateProfilePageDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString({ message: 'bio 必须是字符串' })
  @MaxLength(100, { message: 'bio 不能超过 100 个字符' })
  bio?: string | null;

  @IsOptional()
  @IsString({ message: '个人介绍必须是字符串' })
  @MaxLength(10000, { message: '个人介绍不能超过 10000 个字符' })
  profileReadme?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray({ message: '置顶内容必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PinnedItemDto)
  pinnedItems?: PinnedItemDto[];

  // GitHub 式资料字段（v9.0）：公开可见
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString({ message: '公司/学校必须是字符串' })
  @MaxLength(100, { message: '公司/学校不能超过 100 个字符' })
  company?: string | null;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString({ message: '所在地必须是字符串' })
  @MaxLength(100, { message: '所在地不能超过 100 个字符' })
  location?: string | null;

  // 链接宽松校验（可裸域名），展示时前端自动补 https://
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString({ message: '个人链接必须是字符串' })
  @MaxLength(200, { message: '个人链接不能超过 200 个字符' })
  link?: string | null;

  // 社交账户：≤4 条、每条 ≤200；字符串条目 trim 并剔除空串，非字符串原样保留交由 @IsString 报 400
  //（v10.0 修复：不再把非字符串条目静默丢弃——[123,null,'ok'] 必须校验失败）
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value
          .map((item) => (typeof item === 'string' ? item.trim() : item))
          .filter((item) => typeof item !== 'string' || item.length > 0)
      : value,
  )
  @IsOptional()
  @IsArray({ message: '社交账户必须是数组' })
  @ArrayMaxSize(4, { message: '社交账户最多 4 条' })
  @IsString({ each: true, message: '社交账户链接必须是字符串' })
  @MaxLength(200, { each: true, message: '社交账户链接不能超过 200 个字符' })
  socials?: string[] | null;
}
