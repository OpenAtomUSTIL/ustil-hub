import { promises as fs } from 'fs';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import {
  FileStorage,
  contentTypeFromKey,
  isValidStorageKey,
} from './storage.types';

export class LocalStorageService implements FileStorage {
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new NotFoundException('文件不存在');
    }
    return path.join(this.baseDir, key);
  }

  async put(key: string, file: Buffer, _contentType: string): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file);
  }

  getUrl(key: string): string {
    return `/api/v1/storage/files/${key}`;
  }

  async remove(key: string): Promise<void> {
    const target = this.resolve(key);
    await fs.rm(target, { force: true });
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string }> {
    const target = this.resolve(key);
    try {
      const data = await fs.readFile(target);
      return { data, contentType: contentTypeFromKey(key) };
    } catch {
      throw new NotFoundException('文件不存在');
    }
  }

  async stat(key: string): Promise<number | null> {
    const target = this.resolve(key);
    try {
      const info = await fs.stat(target);
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  }
}
