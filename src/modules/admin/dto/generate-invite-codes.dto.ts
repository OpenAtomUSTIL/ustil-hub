import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class GenerateInviteCodesDto {
  @Type(() => Number)
  @IsInt({ message: 'count 必须是整数' })
  @Min(1, { message: 'count 最小为 1' })
  @Max(50, { message: 'count 不能超过 50' })
  count: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'maxUses 必须是整数' })
  @Min(1, { message: 'maxUses 最小为 1' })
  @Max(100, { message: 'maxUses 不能超过 100' })
  maxUses: number = 1;

  @IsOptional()
  @IsString({ message: 'expiresAt 必须是字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, {
    message: 'expiresAt 必须是 ISO 8601 UTC 字符串',
  })
  @MaxLength(32, { message: 'expiresAt 过长' })
  expiresAt?: string;
}
