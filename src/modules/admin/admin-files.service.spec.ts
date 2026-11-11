import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '../../common/decorators/roles.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { UploadsService } from '../storage/uploads.service';
import { UsersService } from '../users/users.service';
import { AdminFilesService } from './admin-files.service';

const now = new Date('2026-01-01T00:00:00.000Z');

const attachmentRow = {
  id: '01890a5d-ac96-7000-8000-0000000000f1',
  key: 'assignment-01890a5d-ac96-7000-8000-0000000000k1.pdf',
  originalName: '作业.pdf',
  size: 1024,
  mime: 'application/pdf',
  uploaderId: '01890a5d-ac96-7000-8000-000000000001',
  createdAt: now,
};

describe('AdminFilesService', () => {
  let service: AdminFilesService;

  const uploadsService = {
    listForAdminWindow: jest.fn(),
    getAttachmentRow: jest.fn(),
    removeAttachment: jest.fn(),
    removeStoredObject: jest.fn(),
    statSize: jest.fn(),
    resolveFile: jest.fn(),
    readAttachment: jest.fn(),
  };
  const usersService = {
    listAvatarFilesForAdmin: jest.fn(),
    deleteAvatarFileForAdmin: jest.fn(),
    getAvatarFileForAdmin: jest.fn(),
    findAvatarReferencedKeys: jest.fn(),
    getEmailsByIds: jest.fn(),
  };
  const assignmentsService = {
    listUsedAttachmentIds: jest.fn(),
  };
  const auditLogService = {
    record: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminFilesService,
        { provide: UploadsService, useValue: uploadsService },
        { provide: UsersService, useValue: usersService },
        { provide: AssignmentsService, useValue: assignmentsService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();
    service = moduleRef.get(AdminFilesService);
    uploadsService.listForAdminWindow.mockResolvedValue({ rows: [], total: 0 });
    usersService.listAvatarFilesForAdmin.mockResolvedValue({ rows: [], total: 0 });
    usersService.findAvatarReferencedKeys.mockResolvedValue(new Set());
    usersService.getEmailsByIds.mockResolvedValue(new Map());
    assignmentsService.listUsedAttachmentIds.mockResolvedValue(new Set());
    uploadsService.statSize.mockResolvedValue(null);
  });

  it('删除孤儿附件：204 并写 file.delete 审计', async () => {
    uploadsService.getAttachmentRow.mockResolvedValue(attachmentRow);

    await service.remove(attachmentRow.id, { id: 'admin-1', role: Role.ADMIN });

    expect(uploadsService.removeAttachment).toHaveBeenCalledWith(attachmentRow.id);
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.delete', targetType: 'FILE' }),
    );
  });

  it('被作业提交引用的附件删除返回 409', async () => {
    uploadsService.getAttachmentRow.mockResolvedValue(attachmentRow);
    assignmentsService.listUsedAttachmentIds.mockResolvedValue(new Set([attachmentRow.id]));

    await expect(
      service.remove(attachmentRow.id, { id: 'admin-1', role: Role.ADMIN }),
    ).rejects.toThrow(ConflictException);
    expect(uploadsService.removeAttachment).not.toHaveBeenCalled();
  });

  it('被用户头像引用的文件删除返回 409', async () => {
    uploadsService.getAttachmentRow.mockResolvedValue(attachmentRow);
    usersService.findAvatarReferencedKeys.mockResolvedValue(new Set([attachmentRow.key]));

    await expect(
      service.remove(attachmentRow.id, { id: 'admin-1', role: Role.ADMIN }),
    ).rejects.toThrow(ConflictException);
    expect(uploadsService.removeAttachment).not.toHaveBeenCalled();
  });

  it('删除头像文件：清空 users.avatar_url 并删存储对象', async () => {
    usersService.deleteAvatarFileForAdmin.mockResolvedValue({ key: 'avatar-key.png' });

    await service.remove('avatar:01890a5d-ac96-7000-8000-000000000001', {
      id: 'admin-1',
      role: Role.ADMIN,
    });

    expect(usersService.deleteAvatarFileForAdmin).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000001',
    );
    expect(uploadsService.removeStoredObject).toHaveBeenCalledWith('avatar-key.png');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.delete' }),
    );
  });

  it('头像条目不存在返回 404；非法 id 返回 400', async () => {
    usersService.deleteAvatarFileForAdmin.mockResolvedValue(null);
    await expect(
      service.remove('avatar:01890a5d-ac96-7000-8000-000000000001', {
        id: 'admin-1',
        role: Role.ADMIN,
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.remove('not-a-uuid', { id: 'admin-1', role: Role.ADMIN }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.remove('avatar:bad', { id: 'admin-1', role: Role.ADMIN }),
    ).rejects.toThrow(BadRequestException);
  });

  it('列表合并 ATTACHMENT 与 AVATAR 条目并标注 isImage/referenced', async () => {
    uploadsService.listForAdminWindow.mockResolvedValue({ rows: [attachmentRow], total: 1 });
    usersService.listAvatarFilesForAdmin.mockResolvedValue({
      rows: [
        {
          userId: '01890a5d-ac96-7000-8000-000000000001',
          email: 'a@example.com',
          nickname: '甲',
          key: '01890a5d-ac96-7000-8000-0000000000k2.png',
          updatedAt: now,
        },
      ],
      total: 1,
    });
    assignmentsService.listUsedAttachmentIds.mockResolvedValue(new Set([attachmentRow.id]));
    usersService.findAvatarReferencedKeys.mockResolvedValue(new Set());
    usersService.getEmailsByIds.mockResolvedValue(
      new Map([[attachmentRow.uploaderId, 'a@example.com']]),
    );
    uploadsService.statSize.mockResolvedValue(2048);

    const result = await service.list(
      { page: 1, pageSize: 20 },
      { id: 'admin-1', role: Role.ADMIN },
    );

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    const attachmentItem = result.items.find((item) => item.kind === 'ATTACHMENT');
    const avatarItem = result.items.find((item) => item.kind === 'AVATAR');
    expect(attachmentItem).toMatchObject({
      fileName: '作业.pdf',
      isImage: false,
      referenced: true,
      uploaderEmail: 'a@example.com',
      sizeBytes: 1024,
    });
    expect(avatarItem).toMatchObject({
      id: 'avatar:01890a5d-ac96-7000-8000-000000000001',
      kind: 'AVATAR',
      isImage: true,
      referenced: false,
      sizeBytes: 2048,
    });
  });

  it('resolveContent：附件与头像均可取回内容（正常路径）', async () => {
    uploadsService.getAttachmentRow.mockResolvedValue(attachmentRow);
    uploadsService.readAttachment.mockResolvedValue({ data: Buffer.from('x'), contentType: 'application/pdf' });

    await expect(
      service.resolveContent(attachmentRow.id, { id: 'wheel-1', role: Role.WHEEL }),
    ).resolves.toEqual({ data: Buffer.from('x'), contentType: 'application/pdf' });
    expect(uploadsService.readAttachment).toHaveBeenCalledWith(attachmentRow.id);
    expect(uploadsService.resolveFile).not.toHaveBeenCalled();

    uploadsService.resolveFile.mockResolvedValue({ data: Buffer.from('x'), contentType: 'image/png' });
    usersService.getAvatarFileForAdmin.mockResolvedValue({ key: 'avatar-key.png' });
    await service.resolveContent('avatar:01890a5d-ac96-7000-8000-000000000001', {
      id: 'wheel-1',
      role: Role.WHEEL,
    });
    expect(usersService.getAvatarFileForAdmin).toHaveBeenCalledWith(
      '01890a5d-ac96-7000-8000-000000000001',
    );
    expect(uploadsService.resolveFile).toHaveBeenCalledWith('avatar-key.png');
  });

  it('resolveContent：文件不存在 404，非法 id 400，MEMBER 越权 403', async () => {
    uploadsService.getAttachmentRow.mockResolvedValue(null);
    await expect(
      service.resolveContent('01890a5d-ac96-7000-8000-000000000009', {
        id: 'wheel-1',
        role: Role.WHEEL,
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.resolveContent('not-a-uuid', { id: 'wheel-1', role: Role.WHEEL }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.resolveContent(attachmentRow.id, { id: 'member-1', role: Role.MEMBER }),
    ).rejects.toThrow(ForbiddenException);
  });
});
