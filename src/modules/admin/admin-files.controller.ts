import { Controller, Delete, Get, HttpCode, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { AdminFilesService } from './admin-files.service';
import { AdminFilesQueryDto } from './dto/admin-files-query.dto';

@Controller('admin/files')
@Roles(Role.WHEEL, Role.ADMIN)
export class AdminFilesController {
  constructor(private readonly adminFilesService: AdminFilesService) {}

  @Get()
  list(@Query() query: AdminFilesQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.adminFilesService.list(query, user);
  }

  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { data, contentType } = await this.adminFilesService.resolveContent(id, user);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(data);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser): Promise<void> {
    return this.adminFilesService.remove(id, user);
  }
}
