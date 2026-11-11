import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class OnlineUsersQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'minutes 必须是整数' })
  @Min(1, { message: 'minutes 最小为 1' })
  @Max(1440, { message: 'minutes 最大为 1440' })
  minutes: number = 15;
}
