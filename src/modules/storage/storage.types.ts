// 存储抽象（AGENTS.md §12.1 固定接口，业务代码只依赖本接口）
export interface StorageService {
  put(key: string, file: Buffer, contentType: string): Promise<void>;
  getUrl(key: string): string;
  remove(key: string): Promise<void>;
}

export interface AttachmentView {
  id: string;
  key: string;
  originalName: string;
  size: number;
  mime: string;
  url: string;
}

// 文件内容读取（仅 storage 模块内部服务接口使用）
export interface StorageContentReader {
  get(key: string): Promise<{ data: Buffer; contentType: string }>;
}

// 文件大小探测（管理端文件管理用；仅 storage 模块内部服务接口使用）
export interface StorageStatReader {
  /** 返回对象字节数；对象不存在返回 null */
  stat(key: string): Promise<number | null>;
}

export type FileStorage = StorageService & StorageContentReader & StorageStatReader;

export const STORAGE_SERVICE = 'STORAGE_SERVICE';

// 新作业文件带私有标记；兼容已有 UUID key，禁止路径分隔符。
export const STORAGE_KEY_PATTERN = /^(?:assignment-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-zA-Z0-9]+$/;

export function isValidStorageKey(key: string): boolean {
  return STORAGE_KEY_PATTERN.test(key);
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  zip: 'application/zip',
};

export function contentTypeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return EXT_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}
