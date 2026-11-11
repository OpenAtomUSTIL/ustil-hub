import { applyDecorators } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

// 文章 / Issue / 资源 通用标签字段：≤10 个、每个 ≤30 字符；trim 与大小写去重在 TagsService 完成
export function TagsField(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsArray({ message: 'tags 必须是数组' }),
    ArrayMaxSize(10, { message: 'tags 不能超过 10 个' }),
    IsString({ each: true, message: 'tags 项必须是字符串' }),
    MaxLength(30, { each: true, message: '标签不能超过 30 个字符' }),
  );
}
