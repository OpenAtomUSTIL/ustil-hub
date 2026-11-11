import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsRepository } from './tags.repository';
import { TagsService } from './tags.service';

@Module({
  controllers: [TagsController],
  providers: [TagsRepository, TagsService],
  exports: [TagsService],
})
export class TagsModule {}
