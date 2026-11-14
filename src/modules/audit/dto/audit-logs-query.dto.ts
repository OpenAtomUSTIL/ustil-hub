import { IsOptional, IsString, MaxLength } from 'class-validator';
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

  // 解析式寻址（v6.0）：uuid / 用户名 / 邮箱 / 手机号，服务端解析后过滤
  @IsOptional()
  @IsString({ message: 'actorId 必须是字符串' })
  @MaxLength(255, { message: 'actorId 过长' })
  actorId?: string;
}
