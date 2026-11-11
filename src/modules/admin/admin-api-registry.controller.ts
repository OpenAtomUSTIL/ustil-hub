import { Controller, Get } from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { ApiRegistryService } from './api-registry.service';

@Controller('admin/api-registry')
@Roles(Role.WHEEL, Role.ADMIN)
export class AdminApiRegistryController {
  constructor(private readonly apiRegistryService: ApiRegistryService) {}

  @Get()
  list(@CurrentUser() user: CurrentAuthUser) {
    return this.apiRegistryService.list(user);
  }
}
