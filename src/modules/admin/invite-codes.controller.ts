import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { GenerateInviteCodesDto } from './dto/generate-invite-codes.dto';
import { ListInviteCodesDto } from './dto/list-invite-codes.dto';
import { InviteCodesService } from './invite-codes.service';

@Controller('admin/invite-codes')
@Roles(Role.WHEEL, Role.ADMIN)
export class InviteCodesController {
  constructor(private readonly inviteCodesService: InviteCodesService) {}

  @Post()
  generate(@CurrentUser() user: CurrentAuthUser, @Body() dto: GenerateInviteCodesDto) {
    return this.inviteCodesService.generate(user.id, dto);
  }

  @Get()
  list(@Query() dto: ListInviteCodesDto) {
    return this.inviteCodesService.list(dto);
  }

  @Post(':id/revoke')
  @HttpCode(204)
  revoke(@Param('id', uuidParamPipe) id: string): Promise<void> {
    return this.inviteCodesService.revoke(id);
  }
}
