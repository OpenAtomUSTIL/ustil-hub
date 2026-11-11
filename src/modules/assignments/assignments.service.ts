import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Page } from '../../common/dto/page';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/decorators/roles.decorator';
import { AttachmentView } from '../storage/storage.types';
import { UploadedFileInput, UploadsService } from '../storage/uploads.service';
import { UsersService } from '../users/users.service';
import { UserPublic } from '../users/users.views';
import {
  AssignmentRow,
  AssignmentsRepository,
  SubmissionRow,
} from './assignments.repository';
import { AssignmentItem, AssignmentState, SubmissionView } from './assignments.views';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { SubmitSubmissionDto } from './dto/submit-submission.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly assignmentsRepository: AssignmentsRepository,
    private readonly usersService: UsersService,
    private readonly uploadsService: UploadsService,
  ) {}

  // 状态由时间派生，截止判断以服务端时间为准（AGENTS.md §13）
  private deriveState(startAt: Date, deadlineAt: Date, now: Date): AssignmentState {
    if (now.getTime() < startAt.getTime()) {
      return 'NOT_STARTED';
    }
    if (now.getTime() > deadlineAt.getTime()) {
      return 'CLOSED';
    }
    return 'OPEN';
  }

  private toSubmissionView(row: SubmissionRow, submitter: UserPublic, attachment: AttachmentView): SubmissionView {
    return {
      id: row.id,
      assignmentId: row.assignmentId,
      submitter,
      note: row.note,
      attachment,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItem(
    row: AssignmentRow,
    publisher: UserPublic,
    state: AssignmentState,
    viewerRole: Role,
    mySubmission: SubmissionView | null,
  ): AssignmentItem {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startAt: row.startAt.toISOString(),
      deadlineAt: row.deadlineAt.toISOString(),
      state,
      canSubmit:
        (viewerRole === Role.MEMBER || viewerRole === Role.ALUMNI) && state === 'OPEN',
      publisher,
      mySubmission,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async requireAssignment(id: string): Promise<AssignmentRow> {
    const row = await this.assignmentsRepository.findById(id);
    if (!row) {
      throw new NotFoundException('作业不存在');
    }
    return row;
  }

  private assertWindowValid(startAt: Date, deadlineAt: Date): void {
    if (deadlineAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException('截止时间必须晚于开始时间');
    }
  }

  private async publisherOf(row: AssignmentRow): Promise<UserPublic> {
    const map = await this.usersService.getPublicByIds([row.publisherId]);
    const publisher = map.get(row.publisherId);
    if (!publisher) {
      throw new NotFoundException('用户不存在');
    }
    return publisher;
  }

  private async submissionViewOf(
    submission: SubmissionRow,
  ): Promise<SubmissionView> {
    const submitters = await this.usersService.getPublicByIds([submission.submitterId]);
    const submitter = submitters.get(submission.submitterId);
    const attachment = await this.uploadsService.getAttachmentView(submission.attachmentId);
    if (!submitter || !attachment) {
      throw new NotFoundException('提交记录不存在');
    }
    return this.toSubmissionView(submission, submitter, attachment);
  }

  async list(
    query: { page: number; pageSize: number },
    user: CurrentAuthUser,
  ): Promise<Page<AssignmentItem>> {
    if (user.role === Role.VISITOR) {
      throw new ForbiddenException('无权访问该资源');
    }
    const { rows, total } = await this.assignmentsRepository.list(query.page, query.pageSize);
    const userMap = await this.usersService.getPublicByIds([
      ...rows.map((row) => row.publisherId),
      user.id,
    ]);
    const mySubmissions = await this.assignmentsRepository.findMySubmissions(
      rows.map((row) => row.id),
      user.id,
    );
    const myByAssignment = new Map(mySubmissions.map((s) => [s.assignmentId, s]));
    const attachmentIds = mySubmissions.map((s) => s.attachmentId);
    const attachments = await this.uploadsService.getAttachmentViews(attachmentIds);

    const items: AssignmentItem[] = [];
    for (const row of rows) {
      const publisher = userMap.get(row.publisherId);
      if (!publisher) {
        throw new NotFoundException('用户不存在');
      }
      const submissionRow = myByAssignment.get(row.id) ?? null;
      let mySubmission: SubmissionView | null = null;
      if (submissionRow) {
        const attachment = attachments.get(submissionRow.attachmentId);
        const submitter = userMap.get(submissionRow.submitterId);
        if (!attachment || !submitter) {
          throw new NotFoundException('提交记录不存在');
        }
        mySubmission = this.toSubmissionView(submissionRow, submitter, attachment);
      }
      items.push(
        this.toItem(
          row,
          publisher,
          this.deriveState(row.startAt, row.deadlineAt, new Date()),
          user.role,
          mySubmission,
        ),
      );
    }
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getDetail(id: string, user: CurrentAuthUser): Promise<AssignmentItem> {
    if (user.role === Role.VISITOR) {
      throw new ForbiddenException('无权访问该资源');
    }
    const row = await this.requireAssignment(id);
    const publisher = await this.publisherOf(row);
    const submissionRow = await this.assignmentsRepository.findSubmission(id, user.id);
    const mySubmission = submissionRow ? await this.submissionViewOf(submissionRow) : null;
    return this.toItem(
      row,
      publisher,
      this.deriveState(row.startAt, row.deadlineAt, new Date()),
      user.role,
      mySubmission,
    );
  }

  async create(user: CurrentAuthUser, dto: CreateAssignmentDto): Promise<AssignmentItem> {
    if (user.role !== Role.ADMIN && user.role !== Role.ALUMNI && user.role !== Role.WHEEL) {
      throw new ForbiddenException('无权访问该资源');
    }
    this.assertWindowValid(dto.startAt, dto.deadlineAt);
    const row = await this.assignmentsRepository.insert({
      title: dto.title,
      description: dto.description,
      publisherId: user.id,
      startAt: dto.startAt,
      deadlineAt: dto.deadlineAt,
    });
    return this.getDetail(row.id, user);
  }

  async update(
    id: string,
    user: CurrentAuthUser,
    dto: UpdateAssignmentDto,
  ): Promise<AssignmentItem> {
    const row = await this.requireAssignment(id);
    if (row.publisherId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    const startAt = dto.startAt ?? row.startAt;
    const deadlineAt = dto.deadlineAt ?? row.deadlineAt;
    this.assertWindowValid(startAt, deadlineAt);
    if (
      dto.title === undefined &&
      dto.description === undefined &&
      dto.startAt === undefined &&
      dto.deadlineAt === undefined
    ) {
      return this.getDetail(id, user);
    }
    await this.assignmentsRepository.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.startAt !== undefined ? { startAt: dto.startAt } : {}),
      ...(dto.deadlineAt !== undefined ? { deadlineAt: dto.deadlineAt } : {}),
    });
    return this.getDetail(id, user);
  }

  async submit(
    id: string,
    user: CurrentAuthUser,
    file: UploadedFileInput,
    dto: SubmitSubmissionDto,
  ): Promise<SubmissionView> {
    const row = await this.requireAssignment(id);
    if (user.role !== Role.MEMBER && user.role !== Role.ALUMNI) {
      throw new ForbiddenException('仅学习成员或校友可提交作业');
    }
    const state = this.deriveState(row.startAt, row.deadlineAt, new Date());
    if (state !== 'OPEN') {
      throw new ForbiddenException('当前不在可提交时间内');
    }

    const attachment = await this.uploadsService.saveAssignmentFile(file, user.id);
    const previous = await this.assignmentsRepository.findSubmission(id, user.id);
    const submission = await this.assignmentsRepository.upsertSubmission({
      assignmentId: id,
      submitterId: user.id,
      note: dto.note ?? null,
      attachmentId: attachment.id,
    });
    if (previous && previous.attachmentId !== attachment.id) {
      // 覆盖旧提交时清理旧附件（提交记录本身不删除）
      await this.uploadsService.removeAttachment(previous.attachmentId);
    }
    return this.toSubmissionView(submission, await this.submitterOf(user.id), attachment);
  }

  private async submitterOf(userId: string): Promise<UserPublic> {
    const map = await this.usersService.getPublicByIds([userId]);
    const submitter = map.get(userId);
    if (!submitter) {
      throw new NotFoundException('用户不存在');
    }
    return submitter;
  }

  async listSubmissions(
    id: string,
    user: CurrentAuthUser,
    query: { page: number; pageSize: number },
  ): Promise<Page<SubmissionView>> {
    const row = await this.requireAssignment(id);
    if (row.publisherId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('无权访问该资源');
    }
    const { rows, total } = await this.assignmentsRepository.listSubmissions(
      id,
      query.page,
      query.pageSize,
    );
    const submitters = await this.usersService.getPublicByIds(rows.map((s) => s.submitterId));
    const attachments = await this.uploadsService.getAttachmentViews(rows.map((s) => s.attachmentId));
    const items = rows.map((s) => {
      const submitter = submitters.get(s.submitterId);
      const attachment = attachments.get(s.attachmentId);
      if (!submitter || !attachment) {
        throw new NotFoundException('提交记录不存在');
      }
      return this.toSubmissionView(s, submitter, attachment);
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
