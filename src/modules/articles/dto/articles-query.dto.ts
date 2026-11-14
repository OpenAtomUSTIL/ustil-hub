import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ArticlesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(100, { message: 'keyword 过长' })
  keyword?: string;

  // 解析式寻址（v6.0）：uuid / 用户名 / 邮箱 / 手机号，服务端解析后过滤
  @IsOptional()
  @IsString({ message: 'authorId 必须是字符串' })
  @MaxLength(255, { message: 'authorId 过长' })
  authorId?: string;

  @IsOptional()
  @IsString({ message: 'tag 必须是字符串' })
  @MaxLength(30, { message: 'tag 过长' })
  tag?: string;
}
