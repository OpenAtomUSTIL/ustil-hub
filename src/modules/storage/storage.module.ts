import { Module } from '@nestjs/common';
import { AppConfig, configuration } from '../../config/configuration';
import { AttachmentsRepository } from './attachments.repository';
import { LocalStorageService } from './local-storage.service';
import { R2StorageService } from './r2-storage.service';
import { StorageController } from './storage.controller';
import { FileStorage, STORAGE_SERVICE } from './storage.types';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [StorageController],
  providers: [
    AttachmentsRepository,
    UploadsService,
    {
      provide: STORAGE_SERVICE,
      useFactory: (cfg: AppConfig): FileStorage => {
        if (cfg.storage.driver === 'r2') {
          return new R2StorageService(cfg.storage.r2);
        }
        return new LocalStorageService(cfg.storage.localDir);
      },
      inject: [configuration.KEY],
    },
  ],
  exports: [UploadsService, STORAGE_SERVICE],
})
export class StorageModule {}
