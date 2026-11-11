import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminLogsService } from './admin-logs.service';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditLogsController } from './audit-logs.controller';
import { LoginLogsController } from './login-logs.controller';
import { LoginLogsRepository } from './login-logs.repository';
import { LoginLogsService } from './login-logs.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { RequestLogsController } from './request-logs.controller';
import { RequestLogsRepository } from './request-logs.repository';

@Module({
  controllers: [RequestLogsController, AuditLogsController, LoginLogsController],
  providers: [
    AuditLogService,
    AuditLogRepository,
    RequestLogsRepository,
    LoginLogsService,
    LoginLogsRepository,
    AdminLogsService,
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
  exports: [AuditLogService, LoginLogsService],
})
export class AuditModule {}
