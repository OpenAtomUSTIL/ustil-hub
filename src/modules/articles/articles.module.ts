import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TagsModule } from '../tags/tags.module';
import { UsersModule } from '../users/users.module';
import { ArticlesController } from './articles.controller';
import { ArticlesRepository } from './articles.repository';
import { ArticlesService } from './articles.service';

@Module({
  imports: [UsersModule, TagsModule, AuditModule],
  controllers: [ArticlesController],
  providers: [ArticlesRepository, ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
