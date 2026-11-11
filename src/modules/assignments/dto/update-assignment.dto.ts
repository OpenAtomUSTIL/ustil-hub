import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, ValidateIf, IsString, MaxLength } from 'class-validator';

export class UpdateAssignmentDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '描述必须是字符串' })
  @IsNotEmpty({ message: '描述不能为空' })
  description?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Date)
  @IsDate({ message: 'startAt 必须是合法时间' })
  startAt?: Date;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Date)
  @IsDate({ message: 'deadlineAt 必须是合法时间' })
  deadlineAt?: Date;
}
