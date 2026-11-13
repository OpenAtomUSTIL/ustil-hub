import { IsString, Length, Matches } from 'class-validator';

export class UpdateUsernameDto {
  @IsString()
  @Length(2, 32)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: '用户名只能包含字母、数字、- 或 _' })
  username!: string;
}
