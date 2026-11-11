import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ResourceCategory } from '../../../db/schema';

export class ResourcesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['GITHUB', 'EXAM', 'EBOOK', 'DOCUMENT', 'OTHER'], { message: 'category 取值非法' })
  category?: ResourceCategory;

  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(100, { message: 'keyword 过长' })
  keyword?: string;

  @IsOptional()
  @IsString({ message: 'tag 必须是字符串' })
  @MaxLength(30, { message: 'tag 过长' })
  tag?: string;
}
