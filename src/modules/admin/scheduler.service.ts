import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SnakeService } from '../users/snake.service';
import { UsersService } from '../users/users.service';

/** 定时任务（单实例部署直接跑在 api 进程；多实例需加 pg advisory lock 防并发） */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly snakeService: SnakeService,
  ) {}

  // 每日 03:00：删除创建满 7 天的 VISITOR（7 天内未持码转正）
  @Cron('0 3 * * *')
  async cleanupVisitors(): Promise<void> {
    const count = await this.usersService.cleanupExpiredVisitors();
    if (count > 0) {
      this.logger.log(`cleaned up ${count} expired visitor(s)`);
    }
  }

  // 每日 03:10：MEMBER 注册满 4 年自动升 ALUMNI
  @Cron('10 3 * * *')
  async promoteMembers(): Promise<void> {
    const count = await this.usersService.promoteExpiredMembers();
    if (count > 0) {
      this.logger.log(`promoted ${count} member(s) to alumni`);
    }
  }

  // 每日 03:20：刷新全员贡献贪吃蛇 SVG（个人主页 README 预生成动画）
  @Cron('20 3 * * *')
  async refreshSnakes(): Promise<void> {
    const count = await this.snakeService.refreshAll();
    this.logger.log(`refreshed snake animation for ${count} user(s)`);
  }
}
