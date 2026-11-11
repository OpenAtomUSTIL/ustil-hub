import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { UsersService } from '../users/users.service';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Controller('admin/users')
@Roles(Role.WHEEL, Role.ADMIN)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() dto: AdminUsersQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.listForAdmin(dto, user);
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  updateRole(@Param('id', uuidParamPipe) id: string, @Body() dto: UpdateUserRoleDto, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.updateRole(id, dto.role, user);
  }

  @Post(':id/promote')
  promote(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.promoteToAlumni(id, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser): Promise<void> {
    return this.usersService.removeByAdmin(id, user);
  }
}
