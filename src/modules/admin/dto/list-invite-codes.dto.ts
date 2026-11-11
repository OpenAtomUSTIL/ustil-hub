import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListInviteCodesDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'REVOKED'], { message: 'status 只能是 ACTIVE 或 REVOKED' })
  status?: 'ACTIVE' | 'REVOKED';
}
