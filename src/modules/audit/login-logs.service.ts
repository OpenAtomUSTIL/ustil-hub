import { Injectable, Logger } from '@nestjs/common';
import { LoginLogsRepository } from './login-logs.repository';

export interface LoginLogInput {
  userId: string | null;
  /** 登录标识快照（邮箱或手机号） */
  email: string;
  ip: string;
  userAgent: string | null;
  success: boolean;
  failReason?: string | null;
}

/** 登录日志写入：写库失败只告警不打断登录流程 */
@Injectable()
export class LoginLogsService {
  private readonly logger = new Logger(LoginLogsService.name);

  constructor(private readonly loginLogsRepository: LoginLogsRepository) {}

  async record(input: LoginLogInput): Promise<void> {
    try {
      await this.loginLogsRepository.insert({
        userId: input.userId,
        email: input.email,
        ip: input.ip,
        userAgent: input.userAgent,
        success: input.success,
        failReason: input.failReason ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `login log write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
