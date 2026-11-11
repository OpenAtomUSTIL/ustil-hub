export type TrashType = 'ARTICLE' | 'ANNOUNCEMENT' | 'RESOURCE' | 'COMMENT';

export const TRASH_TYPES: TrashType[] = ['ARTICLE', 'ANNOUNCEMENT', 'RESOURCE', 'COMMENT'];

export interface TrashItem {
  id: string;
  type: TrashType;
  title: string;
  summary: string;
  deletedAt: string;
  /** 删除时刻的关键字段快照（由当前行内容还原） */
  original: Record<string, unknown>;
}
