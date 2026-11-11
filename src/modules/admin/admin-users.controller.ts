import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
  list(@Query() dto: AdminUsersQueryDto) {
    return this.usersService.listForAdmin(dto);
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  updateRole(@Param('id', uuidParamPipe) id: string, @Body() dto: UpdateUserRoleDto) {
    return this.usersService.updateRole(id, dto.role);
  }

  @Post(':id/promote')
  promote(@Param('id', uuidParamPipe) id: string) {
    return this.usersService.promoteToAlumni(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuidParamPipe) id: string): Promise<void> {
    return this.usersService.removeByAdmin(id);
  }
}
