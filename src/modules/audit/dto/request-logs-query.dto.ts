import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class RequestLogsQueryDto extends PaginationQueryDto {
  // 解析式寻址（v6.0）：uuid / 用户名 / 邮箱 / 手机号，服务端解析后过滤
  @IsOptional()
  @IsString({ message: 'userId 必须是字符串' })
  @MaxLength(255, { message: 'userId 过长' })
  userId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], {
    message: 'method 取值非法',
  })
  method?: string;
}
