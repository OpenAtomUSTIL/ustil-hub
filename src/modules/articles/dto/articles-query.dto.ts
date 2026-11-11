import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ArticlesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(100, { message: 'keyword 过长' })
  keyword?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'authorId 必须是 uuid' })
  authorId?: string;

  @IsOptional()
  @IsString({ message: 'tag 必须是字符串' })
  @MaxLength(30, { message: 'tag 过长' })
  tag?: string;
}
