import { InviteCodeStatus } from '../../db/schema';

export interface InviteCodeView {
  id: string;
  code: string;
  status: InviteCodeStatus;
  maxUses: number;
  usedCount: number;
  remaining: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface InviteCodePage {
  items: InviteCodeView[];
  total: number;
  page: number;
  pageSize: number;
}
