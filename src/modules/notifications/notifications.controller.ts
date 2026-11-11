import { Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Query() query: NotificationsQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.notificationsService.list(query, user);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: CurrentAuthUser) {
    return this.notificationsService.unreadCount(user);
  }

  @Patch(':id/read')
  @HttpCode(204)
  async markRead(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<void> {
    await this.notificationsService.markRead(id, user);
  }

  @Post('read-all')
  @HttpCode(204)
  async markAllRead(@CurrentUser() user: CurrentAuthUser): Promise<void> {
    await this.notificationsService.markAllRead(user);
  }
}
