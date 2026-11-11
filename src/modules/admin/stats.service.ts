import { Injectable } from '@nestjs/common';
import { Role } from '../../common/decorators/roles.decorator';
import { InviteCodesRepository } from './invite-codes.repository';
import { UsersService } from '../users/users.service';

export interface AdminStatsView {
  users: Record<Role, number>;
  activeInviteCodes: number;
  visitorPendingCleanup: number;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly inviteCodesRepository: InviteCodesRepository,
  ) {}

  async getStats(): Promise<AdminStatsView> {
    const now = new Date();
    const users = await this.usersService.countByRole();
    // VISITOR 待清理：创建已满 7 天仍为 VISITOR（每日 03:00 定时清理）
    const visitorPendingCleanup = await this.usersService.countVisitorsCreatedBefore(
      new Date(now.getTime() - 7 * 24 * 3600 * 1000),
    );
    const activeInviteCodes = await this.inviteCodesRepository.countActive(now);
    return {
      users: {
        VISITOR: users.VISITOR ?? 0,
        MEMBER: users.MEMBER ?? 0,
        ALUMNI: users.ALUMNI ?? 0,
        WHEEL: users.WHEEL ?? 0,
        ADMIN: users.ADMIN ?? 0,
      },
      activeInviteCodes,
      visitorPendingCleanup,
    };
  }
}
