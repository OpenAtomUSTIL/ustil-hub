export type FileKind = 'ATTACHMENT' | 'AVATAR';

export interface FileItem {
  id: string;
  fileName: string;
  sizeBytes: number;
  kind: FileKind;
  uploaderId: string;
  uploaderEmail: string | null;
  isImage: boolean;
  /** 是否被业务数据引用；AVATAR 条目恒为 false（删除即清空对应头像引用） */
  referenced: boolean;
  createdAt: string;
}
