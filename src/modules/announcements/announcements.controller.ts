import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsQueryDto } from './dto/announcements-query.dto';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcements.dto';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  list(@Query() query: AnnouncementsQueryDto) {
    return this.announcementsService.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.announcementsService.getDetail(id);
  }

  @Post()
  @Roles(Role.WHEEL, Role.ADMIN)
  create(@CurrentUser() user: CurrentAuthUser, @Body() dto: CreateAnnouncementDto) {
    return this.announcementsService.create(user, dto);
  }

  @Patch(':id')
  update(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcementsService.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<void> {
    await this.announcementsService.remove(id, user);
  }
}
