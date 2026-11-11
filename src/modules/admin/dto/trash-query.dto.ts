import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TRASH_TYPES, TrashType } from '../trash.views';

function toUpper({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

export class TrashQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(toUpper)
  @IsIn(TRASH_TYPES, { message: 'type 取值非法' })
  type?: TrashType;
}

export class TrashRestoreParamsDto {
  @Transform(toUpper)
  @IsIn(TRASH_TYPES, { message: 'type 取值非法' })
  type!: TrashType;

  @IsUUID(undefined, { message: 'ID 格式错误' })
  id!: string;
}
