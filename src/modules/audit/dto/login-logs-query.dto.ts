import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class LoginLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'email 必须是字符串' })
  @MaxLength(100, { message: 'email 过长' })
  email?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return value;
  })
  @IsBoolean({ message: 'success 必须是布尔值' })
  success?: boolean;
}
