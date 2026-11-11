import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { UploadsService } from './uploads.service';

@Controller('storage')
export class StorageController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Get('files/:key')
  async getFile(
    @Param('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { data, contentType } = await this.uploadsService.resolveFile(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(data);
  }
}
