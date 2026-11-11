import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AuditLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'action 必须是字符串' })
  @MaxLength(100, { message: 'action 过长' })
  action?: string;

  @IsOptional()
  @IsString({ message: 'targetType 必须是字符串' })
  @MaxLength(50, { message: 'targetType 过长' })
  targetType?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'actorId 必须是 uuid' })
  actorId?: string;
}
