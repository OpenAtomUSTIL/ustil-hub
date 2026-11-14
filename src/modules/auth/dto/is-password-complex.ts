import { registerDecorator, ValidationOptions } from 'class-validator';

const CLASS_PATTERNS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];

/** 8~128 位且大写/小写/数字/符号四类中至少两类（v6.0；仅新注册与改密生效） */
export function isPasswordComplex(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 8 || value.length > 128) return false;
  return CLASS_PATTERNS.filter((pattern) => pattern.test(value)).length >= 2;
}

export function IsPasswordComplex(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPasswordComplex',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isPasswordComplex(value);
        },
        defaultMessage(): string {
          return '密码需包含大写字母、小写字母、数字、符号中的至少两类';
        },
      },
    });
  };
}
