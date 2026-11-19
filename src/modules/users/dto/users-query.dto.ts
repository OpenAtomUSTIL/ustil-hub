import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** 人员搜索：keyword 必填（trim 后非空），昵称/用户名模糊匹配 */
export class UsersQueryDto extends PaginationQueryDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'keyword 必须是字符串' })
  @IsNotEmpty({ message: 'keyword 不能为空' })
  @MaxLength(100, { message: 'keyword 过长' })
  keyword!: string;
}
