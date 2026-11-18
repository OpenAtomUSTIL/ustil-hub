import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfig, configuration } from '../../config/configuration';
import { AttachmentsRepository } from './attachments.repository';
import { STORAGE_SERVICE } from './storage.types';
import { UploadsService } from './uploads.service';

const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  trustProxyHops: 0,
  corsOrigin: 'http://localhost:5173',
  databaseUrl: 'postgres://test',
  redisUrl: 'redis://test',
  jwtAccessSecret: 'test-access-secret-0123456789',
  jwtRefreshSecret: 'test-refresh-secret-0123456789',
  storage: {
    driver: 'local',
    localDir: './storage',
    r2: {
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: '',
      publicBaseUrl: '',
    },
  },
  uploadMaxSize: 1024,
  mail: {
    driver: 'none',
    from: '',
    linkBase: 'https://forum.openatomustil.cn',
    templateIds: {
      'verify-code': 0,
      'reset-password': 0,
      'notice-reply': 0,
      'notice-generic': 0,
    },
    api: { secretId: '', secretKey: '', region: 'ap-guangzhou' },
    smtp: { host: '', port: 465, user: '', pass: '' },
  },
};

describe('UploadsService', () => {
  let service: UploadsService;

  const storage = {
    put: jest.fn(),
    getUrl: jest.fn(),
    remove: jest.fn(),
    get: jest.fn(),
  };
  const attachmentsRepository = {
    listPendingDeletions: jest.fn(),
    hasFileReferences: jest.fn(),
    completeFileDeletion: jest.fn(),
    retryFileDeletion: jest.fn(),
    insert: jest.fn(),
    findById: jest.fn(),
    findByIds: jest.fn(),
    deleteById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: STORAGE_SERVICE, useValue: storage },
        { provide: AttachmentsRepository, useValue: attachmentsRepository },
        { provide: configuration.KEY, useValue: testConfig },
      ],
    }).compile();
    service = moduleRef.get(UploadsService);
    storage.getUrl.mockImplementation(
      (key: string) => `/api/v1/storage/files/${key}`,
    );
    attachmentsRepository.insert.mockImplementation((row: {
      key: string;
      originalName: string;
      size: number;
      mime: string;
      uploaderId: string;
    }) =>
      Promise.resolve({
        id: '01890a5d-ac96-7000-8000-0000000000c1',
        ...row,
        createdAt: new Date(),
      }),
    );
  });

  it('保存作业附件：白名单内文件落库并返回 AttachmentView', async () => {
    const result = await service.saveAssignmentFile(
      {
        buffer: Buffer.from('pdf-bytes'),
        originalname: 'work.pdf',
        mimetype: 'application/pdf',
        size: 9,
      },
      '01890a5d-ac96-7000-8000-000000000002',
    );

    expect(result.originalName).toBe('work.pdf');
    expect(result.url).toBe(`/api/v1/assignments/files/${result.id}`);
    expect(storage.put).toHaveBeenCalledWith(
      result.key,
      expect.any(Buffer),
      'application/pdf',
    );
    expect(attachmentsRepository.insert).toHaveBeenCalled();
  });

  it('扩展名与 mime 不匹配返回 400', async () => {
    await expect(
      service.saveAssignmentFile(
        {
          buffer: Buffer.from('img'),
          originalname: 'fake.pdf',
          mimetype: 'image/png',
          size: 3,
        },
        '01890a5d-ac96-7000-8000-000000000002',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('超过 UPLOAD_MAX_SIZE 返回 400', async () => {
    await expect(
      service.saveAssignmentFile(
        {
          buffer: Buffer.alloc(2048),
          originalname: 'big.pdf',
          mimetype: 'application/pdf',
          size: 2048,
        },
        '01890a5d-ac96-7000-8000-000000000002',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });
  it('持久化删除成功后才清除记录', async () => {
    const key = 'assignment-01890a5d-ac96-7000-8000-000000000001.pdf';
    attachmentsRepository.listPendingDeletions.mockResolvedValue([{ key }]);
    attachmentsRepository.hasFileReferences.mockResolvedValue(false);
    storage.remove.mockResolvedValue(undefined);
    expect(await service.flushPendingFileDeletions()).toBe(1);
    expect(storage.remove).toHaveBeenCalledWith(key);
    expect(attachmentsRepository.completeFileDeletion).toHaveBeenCalledWith(key);
  });

  it('存储删除失败保留工作记录等待重试', async () => {
    const key = 'assignment-01890a5d-ac96-7000-8000-000000000001.pdf';
    attachmentsRepository.listPendingDeletions.mockResolvedValue([{ key }]);
    attachmentsRepository.hasFileReferences.mockResolvedValue(false);
    storage.remove.mockRejectedValueOnce(new Error('R2 unavailable'));
    expect(await service.flushPendingFileDeletions()).toBe(0);
    expect(attachmentsRepository.retryFileDeletion).toHaveBeenCalledWith(key);
    expect(attachmentsRepository.completeFileDeletion).not.toHaveBeenCalled();
  });

  it('其他用户仍引用的文件不能删除', async () => {
    const key = '01890a5d-ac96-7000-8000-000000000001.png';
    attachmentsRepository.listPendingDeletions.mockResolvedValue([{ key }]);
    attachmentsRepository.hasFileReferences.mockResolvedValue(true);
    expect(await service.flushPendingFileDeletions()).toBe(0);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(attachmentsRepository.retryFileDeletion).toHaveBeenCalledWith(key);
  });

  it('并发触发回收时复用同一轮任务', async () => {
    let resolve!: (rows: { key: string }[]) => void;
    attachmentsRepository.listPendingDeletions.mockReturnValue(new Promise((done) => { resolve = done; }));
    const first = service.flushPendingFileDeletions();
    const second = service.flushPendingFileDeletions();
    resolve([]);
    await Promise.all([first, second]);
    expect(attachmentsRepository.listPendingDeletions).toHaveBeenCalledTimes(1);
  });

});
