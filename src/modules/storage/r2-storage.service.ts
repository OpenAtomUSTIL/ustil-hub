import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NotFoundException } from '@nestjs/common';
import {
  FileStorage,
  contentTypeFromKey,
  isValidStorageKey,
} from './storage.types';

export interface R2StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export class R2StorageService implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly config: R2StorageConfig) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private assertKey(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new NotFoundException('文件不存在');
    }
    return key;
  }

  async put(key: string, file: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.assertKey(key),
        Body: file,
        ContentType: contentType,
      }),
    );
  }

  getUrl(key: string): string {
    return `/api/v1/storage/files/${this.assertKey(key)}`;
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.assertKey(key) }),
    );
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string }> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: this.assertKey(key) }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) {
        throw new NotFoundException('文件不存在');
      }
      return {
        data: Buffer.from(bytes),
        contentType: result.ContentType ?? contentTypeFromKey(key),
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException('文件不存在');
    }
  }

  async stat(key: string): Promise<number | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.assertKey(key) }),
      );
      return result.ContentLength ?? null;
    } catch {
      return null;
    }
  }
}
