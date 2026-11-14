import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/** 与同对象另一字段相等（注册确认密码等场景） */
export function IsSameAs(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isSameAs',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const related = (args.object as Record<string, unknown>)[args.constraints[0]];
          return value === related;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} 与 ${args.constraints[0]} 不一致`;
        },
      },
    });
  };
}
