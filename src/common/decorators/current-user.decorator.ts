import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from './roles.decorator';

export interface CurrentAuthUser {
  id: string;
  role: Role;
  /** 绑定邮箱快照（审计/请求日志用）；手机账号或未绑定时为 null */
  email?: string | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentAuthUser | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentAuthUser }>();
    return data ? request.user?.[data] : request.user;
  },
);
