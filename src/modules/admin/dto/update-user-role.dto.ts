import { IsIn } from 'class-validator';

export class UpdateUserRoleDto {
  // 不允许通过接口授予/变更 ADMIN（ADMIN 仅由种子脚本创建）
  @IsIn(['VISITOR', 'MEMBER', 'ALUMNI', 'WHEEL'], { message: 'role 取值非法' })
  role!: 'VISITOR' | 'MEMBER' | 'ALUMNI' | 'WHEEL';
}
