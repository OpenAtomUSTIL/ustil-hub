import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class RequestLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'userId 必须是 uuid' })
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
