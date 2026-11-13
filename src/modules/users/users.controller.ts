import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser, CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { fileUploadInterceptor } from '../../common/interceptors/file-upload.interceptor';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { UploadedFileInput } from '../storage/uploads.service';
import { renderBadgesSvg, statsToBadges, toShieldsSchema } from './users.badges';
import { SnakeService } from './snake.service';
import { ChangeIdentifierDto } from './dto/change-identifier.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateProfilePageDto } from './dto/update-profile-page.dto';
import { UpdateUsernameDto } from './dto/update-username.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly snakeService: SnakeService,
  ) {}

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

  /** 改主页用户名（handle）：格式与唯一性校验 */
  @Put('me/username')
  updateUsername(@CurrentUser() user: CurrentAuthUser, @Body() dto: UpdateUsernameDto) {
    return this.usersService.updateUsername(user.id, dto);
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

  /** 公开资料（脱敏）：id 或 username 寻址（URL 不暴露裸 id，旧 id 链接兼容） */
  @Get(':id')
  getPublic(@Param('id') id: string) {
    return this.usersService.getPublic(id);
  }

  @Get(':id/profile')
  getProfile(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getProfile(id, user);
  }

  @Put('me/profile-page')
  updateProfilePage(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: UpdateProfilePageDto,
  ) {
    return this.usersService.updateProfilePage(user.id, dto);
  }

  @Get(':id/activity')
  getActivity(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getActivity(id, user);
  }

  /** README 社区数据徽章：公开（仅聚合计数，无私有字段），shields.io endpoint 协议，按用户名寻址 */
  @Public()
  @Get(':username/stats-badge')
  @Header('Cache-Control', 'public, max-age=300')
  async getStatsBadgeJson(@Param('username') username: string) {
    return toShieldsSchema(statsToBadges(await this.usersService.getStatsBadges(username)));
  }

  /** README 社区数据徽章：公开，站内自绘 SVG（shields.io 不可达时的备用），供 <img> 引用 */
  @Public()
  @Get(':username/stats-badge.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async getStatsBadgeSvg(@Param('username') username: string) {
    return renderBadgesSvg(statsToBadges(await this.usersService.getStatsBadges(username)));
  }

  /** README 贡献贪吃蛇：公开，定时任务预生成的动画 SVG（@platane/snk 同款），按用户名寻址 */
  @Public()
  @Get(':username/snake.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async getSnakeSvg(@Param('username') username: string, @Query('theme') theme?: string) {
    return this.snakeService.getSnakeSvg(username, theme === 'dark' ? 'dark' : 'light');
  }

  @Get(':id/replies')
  getReplies(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.getReplies(id, user, query.page, query.pageSize);
  }

  // ===== 关注 =====

  /** 关注（幂等）：MEMBER+ 互访可见者可关注，不能关注自己，VISITOR 403 */
  @Post(':id/follow')
  follow(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.follow(id, user);
  }

  /** 取关（幂等） */
  @Delete(':id/follow')
  unfollow(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.unfollow(id, user);
  }

  /** 粉丝列表（分页，排除封禁） */
  @Get(':id/followers')
  listFollowers(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.listFollowers(id, user, query.page, query.pageSize);
  }

  /** 关注列表（分页，排除封禁） */
  @Get(':id/following')
  listFollowing(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.listFollowing(id, user, query.page, query.pageSize);
  }
}
