import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsDate, isISO8601 } from 'class-validator';

// 与现有 expiresAt 输入契约一致：先校验原始 UTC 字符串，再转换，避免数字被当作毫秒。
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function IsoUtcDateField(field: string): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => {
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value) ||
          !isISO8601(value, { strict: true, strictSeparator: true })) {
        return new Date(NaN);
      }
      return new Date(value);
    }, { toClassOnly: true }),
    IsDate({ message: `${field} 必须是合法的 ISO 8601 UTC 时间字符串` }),
  );
}
