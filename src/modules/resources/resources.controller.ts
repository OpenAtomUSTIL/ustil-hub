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
import { CreateResourceDto, UpdateResourceDto } from './dto/resources.dto';
import { ResourcesQueryDto } from './dto/resources-query.dto';
import { ResourcesService } from './resources.service';

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  list(@Query() query: ResourcesQueryDto) {
    return this.resourcesService.list(query);
  }

  @Get(':id')
  detail(@Param('id', uuidParamPipe) id: string) {
    return this.resourcesService.getDetail(id);
  }

  @Post()
  @Roles(Role.WHEEL, Role.ADMIN)
  create(@CurrentUser() user: CurrentAuthUser, @Body() dto: CreateResourceDto) {
    return this.resourcesService.create(user, dto);
  }

  @Patch(':id')
  update(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: UpdateResourceDto,
  ) {
    return this.resourcesService.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<void> {
    await this.resourcesService.remove(id, user);
  }
}
