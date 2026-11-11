import { SetMetadata } from '@nestjs/common';

export const Role = {
  ADMIN: 'ADMIN',
  ALUMNI: 'ALUMNI',
  MEMBER: 'MEMBER',
  VISITOR: 'VISITOR',
  WHEEL: 'WHEEL',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
