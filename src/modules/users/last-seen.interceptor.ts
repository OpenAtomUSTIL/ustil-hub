import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { PresenceService } from './presence.service';

// 轻量在线状态拦截器：已登录用户的 last_seen_at 节流更新（内部失败静默）
@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
  constructor(private readonly presenceService: PresenceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: CurrentAuthUser }>();
    const user = req.user;
    if (user?.id) {
      this.presenceService.touch(user.id);
    }
    return next.handle();
  }
}
