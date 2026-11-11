import { IsIn, IsOptional, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AdminUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @MaxLength(100, { message: 'keyword 过长' })
  keyword?: string;

  @IsOptional()
  @IsIn(['VISITOR', 'MEMBER', 'ALUMNI', 'WHEEL', 'ADMIN'], {
    message: 'role 取值非法',
  })
  role?: 'VISITOR' | 'MEMBER' | 'ALUMNI' | 'WHEEL' | 'ADMIN';

  @IsOptional()
  @IsIn(['ACTIVE', 'BANNED'], { message: 'status 只能是 ACTIVE 或 BANNED' })
  status?: 'ACTIVE' | 'BANNED';
}
