import { Injectable } from '@nestjs/common';
import { asc, count, desc } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { Database } from '../../db';
import type { AttachmentsRepository } from '../storage/attachments.repository';
import type { UsersRepository } from '../users/users.repository';

type AttachmentSource = ReturnType<AttachmentsRepository['adminFileSource']>;
type AvatarSource = ReturnType<UsersRepository['adminFileSource']>;

/** 只组合所属模块经 service 提供的数据源，不直接访问跨模块表。 */
@Injectable()
export class AdminFilesRepository {
  async list(
    connection: Pick<Database, 'select'>,
    sources: { attachment: AttachmentSource; avatar: AvatarSource },
    params: { kind?: 'ATTACHMENT' | 'AVATAR'; offset: number; pageSize: number },
  ) {
    const source = (params.kind === 'ATTACHMENT' ? sources.attachment
      : params.kind === 'AVATAR' ? sources.avatar
        : unionAll(sources.attachment, sources.avatar)).as('admin_files');
    const rows = await connection.select().from(source)
      .orderBy(desc(source.createdAt), asc(source.kind), desc(source.id))
      .limit(params.pageSize).offset(params.offset);
    const totals = await connection.select({ total: count() }).from(source);
    return { rows, total: totals[0]?.total ?? 0 };
  }
}
