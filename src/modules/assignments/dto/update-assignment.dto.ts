import { Transform } from 'class-transformer';
import { IsNotEmpty, ValidateIf, IsString, MaxLength } from 'class-validator';
import { IsoUtcDateField } from '../../../common/dto/iso-utc-date-field';

export class UpdateAssignmentDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '描述必须是字符串' })
  @IsNotEmpty({ message: '描述不能为空' })
  description?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsoUtcDateField('startAt')
  startAt?: Date;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsoUtcDateField('deadlineAt')
  deadlineAt?: Date;
}
