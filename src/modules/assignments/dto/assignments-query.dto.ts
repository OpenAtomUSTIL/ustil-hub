import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** 作业列表查询：可选 keyword 按标题/描述模糊搜索 */
export class AssignmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(100, { message: 'keyword 过长' })
  keyword?: string;
}
