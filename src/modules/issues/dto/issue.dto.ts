import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TagsField } from '../../../common/dto/tags-field';
import { IssueStatus } from '../../../db/schema';

export class CreateIssueDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title!: string;

  @IsString({ message: '内容必须是字符串' })
  @IsNotEmpty({ message: '内容不能为空' })
  content!: string;

  @TagsField()
  tags?: string[];
}

export class CreateReplyDto {
  @IsString({ message: '内容必须是字符串' })
  @IsNotEmpty({ message: '内容不能为空' })
  content!: string;
}

export class ChangeIssueStatusDto {
  @IsIn(['OPEN', 'ANSWERED', 'ON_HOLD'], { message: 'status 必须是 OPEN、ANSWERED 或 ON_HOLD' })
  status!: IssueStatus;
}

export class IssuesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'ANSWERED', 'ON_HOLD'], { message: 'status 必须是 OPEN、ANSWERED 或 ON_HOLD' })
  status?: IssueStatus;

  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(100, { message: 'keyword 过长' })
  keyword?: string;

  @IsOptional()
  @IsString({ message: 'tag 必须是字符串' })
  @MaxLength(30, { message: 'tag 过长' })
  tag?: string;
}

export class CommentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(100, { message: 'keyword 过长' })
  keyword?: string;
}
