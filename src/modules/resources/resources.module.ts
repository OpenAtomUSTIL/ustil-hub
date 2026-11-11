import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TagsModule } from '../tags/tags.module';
import { UsersModule } from '../users/users.module';
import { ResourcesController } from './resources.controller';
import { ResourcesRepository } from './resources.repository';
import { ResourcesService } from './resources.service';

@Module({
  imports: [UsersModule, TagsModule, AuditModule],
  controllers: [ResourcesController],
  providers: [ResourcesRepository, ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
