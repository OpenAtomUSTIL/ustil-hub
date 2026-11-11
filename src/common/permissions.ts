import { ForbiddenException } from '@nestjs/common';
import { CurrentAuthUser } from './decorators/current-user.decorator';
import { Role } from './decorators/roles.decorator';

export function requireRole(user: CurrentAuthUser, ...roles: Role[]): void {
  if (!user || !roles.includes(user.role)) {
    throw new ForbiddenException('无权访问该资源');
  }
}
