import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { TrashQueryDto, TrashRestoreParamsDto } from './dto/trash-query.dto';
import { TrashService } from './trash.service';

@Controller('admin/trash')
@Roles(Role.WHEEL, Role.ADMIN)
export class TrashController {
  constructor(private readonly trashService: TrashService) {}

  @Get()
  list(@Query() query: TrashQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.trashService.list(query, user);
  }

  @Post(':type/:id/restore')
  @HttpCode(204)
  restore(@Param() params: TrashRestoreParamsDto, @CurrentUser() user: CurrentAuthUser): Promise<void> {
    return this.trashService.restore(params.type, params.id, user);
  }
}
