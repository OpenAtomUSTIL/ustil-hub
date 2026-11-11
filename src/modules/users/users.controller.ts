import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser, CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { fileUploadInterceptor } from '../../common/interceptors/file-upload.interceptor';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { UploadedFileInput } from '../storage/uploads.service';
import { ChangeIdentifierDto } from './dto/change-identifier.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  updateMe(@CurrentUser() user: CurrentAuthUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Put('me/identifier')
  changeIdentifier(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: ChangeIdentifierDto,
  ) {
    return this.usersService.changeIdentifier(user.id, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(fileUploadInterceptor('file'))
  uploadAvatar(
    @CurrentUser() user: CurrentAuthUser,
    @UploadedFile() file: UploadedFileInput,
  ) {
    return this.usersService.uploadAvatar(user.id, file);
  }

  @Post(':id/ban')
  @Roles(Role.ADMIN)
  ban(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.ban(id, user);
  }

  @Post(':id/unban')
  @Roles(Role.ADMIN)
  unban(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.unban(id, user);
  }

  @Get(':id')
  getPublic(@Param('id', uuidParamPipe) id: string) {
    return this.usersService.getPublic(id);
  }
}
