import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import type { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { RequestLogsRepository } from './request-logs.repository';

// Gin 式请求日志：记录全部 /api/v1/** 请求（含 GET）；响应完成后异步写库，失败静默
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly requestLogsRepository: RequestLogsRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request & { user?: CurrentAuthUser }>();
    const res = ctx.getResponse<Response>();

    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (path !== '/api/v1' && !path.startsWith('/api/v1/')) {
      return next.handle();
    }

    const startedAt = Date.now();
    const user = req.user;
    res.on('finish', () => {
      void this.requestLogsRepository
        .insert({
          method: req.method,
          path,
          statusCode: res.statusCode,
          userId: user?.id ?? null,
          userEmail: user?.email ?? null,
          ip: req.ip ?? '',
          userAgent: req.headers['user-agent'] ?? '',
          durationMs: Date.now() - startedAt,
        })
        .catch(() => undefined);
    });
    return next.handle();
  }
}
