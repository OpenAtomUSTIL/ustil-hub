import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewArticleDto {
  @IsIn(['approve', 'reject', 'hide', 'unhide'], { message: '审核操作必须是 approve/reject/hide/unhide' })
  action!: 'approve' | 'reject' | 'hide' | 'unhide';

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString({ message: '审核备注必须是字符串' })
  @MaxLength(500, { message: '审核备注不能超过 500 个字符' })
  note?: string;
}
