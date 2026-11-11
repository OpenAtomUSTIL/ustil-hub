import { Injectable } from '@nestjs/common';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';
import { UsersRepository } from './users.repository';
import { OnlineUsersView } from './users.views';

// 每个用户最多 60 秒写一次 last_seen_at
const TOUCH_THROTTLE_MS = 60 * 1000;
const TOUCH_MAP_LIMIT = 10000;

/** 在线状态：请求触达节流更新 + 在线用户查询 */
@Injectable()
export class PresenceService {
  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly usersRepository: UsersRepository) {}

  // 节流更新最近活跃时间：失败静默，不拖慢请求
  touch(userId: string): void {
    const now = Date.now();
    const previous = this.lastTouchAt.get(userId);
    if (previous !== undefined && now - previous < TOUCH_THROTTLE_MS) {
      return;
    }
    this.lastTouchAt.set(userId, now);
    if (this.lastTouchAt.size > TOUCH_MAP_LIMIT) {
      for (const [id, at] of this.lastTouchAt) {
        if (now - at >= TOUCH_THROTTLE_MS) {
          this.lastTouchAt.delete(id);
        }
      }
    }
    void this.usersRepository.touchLastSeen(userId).catch(() => undefined);
  }

  async listOnline(minutes: number, actor: CurrentAuthUser): Promise<OnlineUsersView> {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const rows = await this.usersRepository.listLastSeenSince(since);
    return {
      minutes,
      total: rows.length,
      items: rows.map((row) => ({
        userId: row.id,
        email: row.email,
        nickname: row.nickname,
        role: row.role as Role,
        lastSeenAt: (row.lastSeenAt ?? since).toISOString(),
      })),
    };
  }
}
