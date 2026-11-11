import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentAuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { fileUploadInterceptor } from '../../common/interceptors/file-upload.interceptor';
import { uuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { UploadedFileInput } from '../storage/uploads.service';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { SubmitSubmissionDto } from './dto/submit-submission.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Get()
  list(@Query() query: PaginationQueryDto, @CurrentUser() user: CurrentAuthUser) {
    return this.assignmentsService.list(query, user);
  }

  @Get(':id')
  detail(@Param('id', uuidParamPipe) id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.assignmentsService.getDetail(id, user);
  }

  @Post()
  @Roles(Role.ADMIN, Role.ALUMNI, Role.WHEEL)
  create(@CurrentUser() user: CurrentAuthUser, @Body() dto: CreateAssignmentDto) {
    return this.assignmentsService.create(user, dto);
  }

  @Patch(':id')
  update(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.assignmentsService.update(id, user, dto);
  }

  @Post(':id/submissions')
  @UseInterceptors(fileUploadInterceptor('file'))
  submit(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @UploadedFile() file: UploadedFileInput,
    @Body() dto: SubmitSubmissionDto,
  ) {
    return this.assignmentsService.submit(id, user, file, dto);
  }

  @Get(':id/submissions')
  listSubmissions(
    @Param('id', uuidParamPipe) id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.assignmentsService.listSubmissions(id, user, query);
  }
}
