import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class PinnedItemDto {
  @IsIn(['ARTICLE', 'ISSUE', 'RESOURCE'], { message: '置顶类型必须是 ARTICLE/ISSUE/RESOURCE' })
  type!: 'ARTICLE' | 'ISSUE' | 'RESOURCE';

  @IsString({ message: '置顶 ID 必须是字符串' })
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

  @IsOptional()
  @IsArray({ message: '置顶内容必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PinnedItemDto)
  pinnedItems?: PinnedItemDto[];
}
