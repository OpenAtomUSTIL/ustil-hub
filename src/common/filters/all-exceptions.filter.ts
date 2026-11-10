import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ErrorBody, STATUS_ERROR_NAME } from '../errors';

// multer 上传体积超限错误的鸭子类型判断（避免直接依赖 multer）
function isMulterLimitError(exception: unknown): boolean {
  return (
    exception instanceof Error &&
    exception.name === 'MulterError' &&
    'code' in exception &&
    (exception as Error & { code: unknown }).code === 'LIMIT_FILE_SIZE'
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ originalUrl?: string; url?: string }>();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = STATUS_ERROR_NAME[HttpStatus.INTERNAL_SERVER_ERROR];
    let message: string | string[] = '服务器内部错误';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (typeof response === 'object' && response !== null) {
        const body = response as { message?: string | string[]; error?: string };
        message = body.message ?? exception.message;
        error = body.error ?? STATUS_ERROR_NAME[statusCode] ?? 'Error';
      }
    } else if (isMulterLimitError(exception)) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = STATUS_ERROR_NAME[HttpStatus.BAD_REQUEST];
      message = '文件大小超出限制';
    }

    const body: ErrorBody = {
      statusCode,
      error,
      message,
      path: request.originalUrl ?? request.url ?? '',
      timestamp: new Date().toISOString(),
    };
    httpAdapter.reply(ctx.getResponse(), body, statusCode);
  }
}
