import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TagsField } from '../../../common/dto/tags-field';

export class CreateArticleDto {
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题不能超过 200 个字符' })
  title!: string;

  @IsString({ message: '正文必须是字符串' })
  @IsNotEmpty({ message: '正文不能为空' })
  content!: string;

  @TagsField()
  tags?: string[];
}
